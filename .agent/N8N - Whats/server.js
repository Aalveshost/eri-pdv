require('dotenv').config();
const express = require('express');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');
const pdfParse = require('pdf-parse');
const QRCode = require('qrcode');
const cookieParser = require('cookie-parser');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} = require('@whiskeysockets/baileys');

const app = express();
app.use(express.json());
app.use(cookieParser());

// Serve PDFs individualmente por URL, sem listar diretório
app.use('/boletos', express.static(path.join(__dirname, 'boletos'), { index: false }));

const PASSWORD = process.env.PASSWORD || 'Paiol2026@@';
const OWNER_PHONE = process.env.OWNER_PHONE || '';
const ADMIN_PHONE = process.env.ADMIN_PHONE || '5535991500311';
const PORT = process.env.PORT || 3001;
const SESSIONS_FILE = './sessions.json';
const CONFIG_FILE = './config.json';
const BOLETOS_DIR = './boletos';

// ─── Salva PDF localmente em boletos/MM-YYYY/<id>.pdf ────────────────
function cleanOldBoletos() {
  try {
    if (!fs.existsSync(BOLETOS_DIR)) return;
    const now = new Date();
    const currentValue = now.getFullYear() * 12 + now.getMonth(); // mês atual em meses absolutos

    fs.readdirSync(BOLETOS_DIR).forEach(name => {
      const match = name.match(/^(\d{2})-(\d{4})$/);
      if (!match) return;
      const folderValue = parseInt(match[2]) * 12 + (parseInt(match[1]) - 1);
      // manter: mês atual + até 6 meses anteriores (diff <= 6)
      if (currentValue - folderValue > 6) {
        fs.rmSync(`${BOLETOS_DIR}/${name}`, { recursive: true, force: true });
        // remove sitemap do mesmo mês
        try { fs.rmSync(path.join(BOLETOS_DIR, `boletos_map_${name}.json`), { force: true }); } catch (_) { }
        console.log(`[boletos] pasta antiga removida: ${name}`);
      }
    });
  } catch (e) {
    console.error('[cleanOldBoletos] erro:', e.message);
  }
}

// ─── Sitemap mensal ──────────────────────────────────────────────────
function sitemapPath(folder) {
  return path.join(BOLETOS_DIR, `boletos_map_${folder}.json`);
}
function loadSitemap(folder) {
  try { return JSON.parse(fs.readFileSync(sitemapPath(folder), 'utf8')); } catch (_) { return []; }
}
function saveSitemapEntry(folder, entry) {
  if (!fs.existsSync(BOLETOS_DIR)) fs.mkdirSync(BOLETOS_DIR, { recursive: true });
  const entries = loadSitemap(folder);
  const idx = entries.findIndex(e => e.hash === entry.hash);
  if (idx >= 0) entries[idx] = { ...entries[idx], ...entry };
  else entries.push(entry);
  fs.writeFileSync(sitemapPath(folder), JSON.stringify(entries, null, 2));
}

function savePdfLocally(url, buffer, meta = {}) {
  try {
    let hash;
    try {
      const parsed = new URL(url);
      hash = parsed.searchParams.get('id') || parsed.pathname.split('/').filter(Boolean).pop();
    } catch (_) { }
    if (!hash) hash = crypto.createHash('md5').update(url).digest('hex').slice(0, 8);

    const npedido = meta.npedido || 'sem-pedido';
    const filename = `${npedido}-${hash}.pdf`;

    const now = new Date();
    const folder = `${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;
    const dir = path.join(BOLETOS_DIR, folder);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const dest = path.join(dir, filename);
    fs.writeFileSync(dest, buffer);

    saveSitemapEntry(folder, {
      hash,
      npedido: meta.npedido || null,
      pagador: meta.pagador || null,
      valor: meta.valor || null,
      dataemissao: toISO(meta.dataemissao) || new Date().toISOString().split('T')[0],
      datavenc: toISO(meta.datavenc) || null,
      codigoBarras: meta.codigoBarras || null,
      status: 'aberto',
      datapgt: null,
      file: filename,
      folder,
      url: '/boletos/' + folder + '/' + filename,
    });

    cleanOldBoletos();
    return { dest, hash, folder, filename };
  } catch (e) {
    console.error('[savePdfLocally] erro ao salvar:', e.message);
    return null;
  }
}

// Converte DD/MM/AAAA para AAAA-MM-DD
function toISO(dateStr) {
  if (!dateStr || !dateStr.includes('/')) return dateStr;
  const [d, m, y] = dateStr.split('/');
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

// ─── Config persistente ──────────────────────────────────────────────
let config = { recoveryPhone: OWNER_PHONE, notificationPhone: ADMIN_PHONE };

function loadConfig() {
  try { Object.assign(config, JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))); } catch (_) { }
}
function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}
loadConfig();

// ─── Auth (persistente em arquivo) ──────────────────────────────────
let sessions = new Set();

function loadSessions() {
  try {
    const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    sessions = new Set(data);
  } catch (_) { }
}

function saveSessions() {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify([...sessions]));
}

loadSessions();

function auth(req, res, next) {
  if (sessions.has(req.cookies?.token)) return next();
  res.redirect('/painel');
}

// ─── WhatsApp ────────────────────────────────────────────────────────
let waSocket = null;
let waReady = false;
let waConnecting = false;
let waQR = null;
let waPhone = null;
let waPairingCode = null;
const logger = pino({ level: 'silent' });

async function connectWhatsApp(pairingPhone = null) {
  if (waReady) return;
  waConnecting = true;
  waQR = null;
  waPairingCode = null;

  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version, auth: state, logger,
    printQRInTerminal: false,
  });

  waSocket = sock;

  // Rastreia quando os creds foram salvos para garantir persistência antes de reconectar
  let credsSaved = Promise.resolve();
  sock.ev.on('creds.update', () => { credsSaved = saveCreds(); });

  // Pairing code: solicita quando o QR estaria sendo gerado (handshake completo)
  if (pairingPhone) {
    const digits = pairingPhone.replace(/\D/g, '');
    const fullPhone = digits.startsWith('55') ? digits : `55${digits}`;
    let codeRequested = false;

    sock.ev.on('connection.update', async ({ qr }) => {
      if (qr && !codeRequested) {
        codeRequested = true;
        try {
          const code = await sock.requestPairingCode(fullPhone);
          waPairingCode = code?.match(/.{1,4}/g)?.join('-') || code;
          console.log('Pairing code gerado:', waPairingCode);
        } catch (e) {
          console.error('Erro ao gerar código:', e.message);
          waConnecting = false;
        }
      }
    });
  }

  // Listener de mensagens recebidas — necessário para o protocolo de sync
  // enviar o echo das mensagens enviadas de volta ao celular principal
  sock.ev.on('messages.upsert', ({ messages }) => {
    // sem processamento — apenas mantém o socket participando do sync
  });

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr && !pairingPhone) {
      waQR = await QRCode.toDataURL(qr);
    }
    if (connection === 'open') {
      waReady = true;
      waConnecting = false;
      waQR = null;
      waPairingCode = null;
      waPhone = sock.user?.id?.split(':')[0] || OWNER_PHONE;
      if (!config.recoveryPhone && waPhone) {
        config.recoveryPhone = waPhone;
        saveConfig();
      }
      console.log('WhatsApp conectado:', waPhone);
    }
    if (connection === 'close') {
      waReady = false;
      waPhone = null;
      const statusCode = lastDisconnect?.error?.output?.statusCode;

      if (statusCode === DisconnectReason.loggedOut) {
        waConnecting = false;
        waPairingCode = null;
        console.log('WhatsApp deslogado.');
        return;
      }

      // Se há pairing code pendente, aguarda os creds serem gravados antes de reconectar
      const hasPendingCode = !!waPairingCode;
      console.log('WhatsApp desconectado, reconectando...' + (hasPendingCode ? ' (aguardando código ser digitado)' : ''));
      setTimeout(async () => {
        if (hasPendingCode) await credsSaved;
        connectWhatsApp(); // reconecta sem pairingPhone — creds já têm o código salvo
      }, 3000);
    }
  });
}

async function disconnectWhatsApp() {
  try { await waSocket?.logout(); } catch (_) { }
  waSocket = null;
  waReady = false;
  waConnecting = false;
  waQR = null;
  waPhone = null;
  fs.rmSync('./auth_info', { recursive: true, force: true });
}

// Auto-reconecta no startup se já existe sessão salva
if (fs.existsSync('./auth_info')) {
  console.log('Sessão do WhatsApp encontrada, reconectando...');
  connectWhatsApp();
}

// ─── HTML ────────────────────────────────────────────────────────────
const loginHTML = () => `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Login — Painel Boleto</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',sans-serif;background:#181818;color:#e0e0e0;
      display:flex;align-items:center;justify-content:center;min-height:100vh}
    .card{background:#222;border:1px solid #333;border-radius:12px;padding:40px 36px;width:360px;
      box-shadow:0 8px 40px #00000055}
    .logo{font-size:.7rem;font-weight:700;letter-spacing:.15em;color:#888;text-transform:uppercase;margin-bottom:20px}
    h1{font-size:1.4rem;font-weight:700;color:#f4f4f4;margin-bottom:6px}
    .sub{color:#aaa;font-size:.88rem;margin-bottom:32px}
    label{font-size:.75rem;font-weight:600;color:#aaa;display:block;margin-bottom:7px;letter-spacing:.04em}
    input[type=password]{width:100%;padding:12px 14px;border-radius:8px;border:1.5px solid #333;
      background:#2a2a2a;color:#f0f0f0;font-size:.95rem;margin-bottom:6px;transition:border .2s}
    input[type=password]:focus{outline:none;border-color:#555}
    .remember{display:flex;align-items:center;gap:8px;margin-bottom:20px;margin-top:10px}
    .remember input[type=checkbox]{width:15px;height:15px;accent-color:#888;cursor:pointer}
    .remember span{font-size:.82rem;color:#aaa;cursor:pointer}
    button.btn-primary{width:100%;padding:13px;border-radius:8px;border:1.5px solid #444;
      background:#2e2e2e;color:#f0f0f0;font-weight:700;font-size:.95rem;cursor:pointer;
      transition:all .2s;letter-spacing:.02em}
    button.btn-primary:hover{background:#383838;border-color:#555}
    .err{color:#e05555;font-size:.82rem;margin-top:14px;padding:10px 14px;
      background:#2a1a1a;border:1px solid #442222;border-radius:6px;display:none}
    .msg{font-size:.82rem;margin-top:12px;text-align:center;display:none;
      padding:10px;border-radius:6px}
    .msg.ok{color:#5c9;background:#1a2a1f;border:1px solid #2a4a30}
    .msg.fail{color:#e05555;background:#2a1a1a;border:1px solid #442222}
    .divider{border:none;border-top:1px solid #2e2e2e;margin:22px 0}
    .forgot-link{display:block;text-align:center;color:#777;font-size:.8rem;cursor:pointer;
      text-decoration:none;transition:color .2s}
    .forgot-link:hover{color:#bbb}
  </style>
</head>
<body>
<div class="card">
  <p class="logo">Painel Boleto</p>
  <h1>Bem-vindo</h1>
  <p class="sub">Entre com sua senha para acessar o painel</p>
  <label>Senha</label>
  <input type="password" id="pw" placeholder="••••••••" onkeydown="if(event.key==='Enter')login()"/>
  <div class="remember">
    <input type="checkbox" id="remember" checked/>
    <span onclick="document.getElementById('remember').click()">Lembrar de mim por 30 dias</span>
  </div>
  <button class="btn-primary" onclick="login()">Entrar</button>
  <div class="err" id="err">Senha incorreta. Tente novamente.</div>
  <div class="msg" id="msg"></div>
  <hr class="divider"/>
  <a class="forgot-link" onclick="forgot()">Esqueci minha senha</a>
</div>
<script>
  async function login() {
    const pw = document.getElementById('pw').value;
    const remember = document.getElementById('remember').checked;
    const res = await fetch('/painel',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({password:pw,remember})});
    if (res.ok) location.href='/';
    else { document.getElementById('err').style.display='block'; }
  }
  async function forgot() {
    const el = document.getElementById('msg');
    const res = await fetch('/forgot-password',{method:'POST'});
    const d = await res.json();
    el.textContent = res.ok ? 'Senha será enviada via WhatsApp em 3 minutos.' : (d.error||'Erro ao solicitar.');
    el.className = 'msg ' + (res.ok ? 'ok' : 'fail');
    el.style.display = 'block';
  }
</script>
</body></html>`;

const dashboardHTML = () => `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Painel Boleto</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',sans-serif;background:#181818;color:#e0e0e0;min-height:100vh}

    /* Header */
    header{background:#222;border-bottom:1px solid #333;padding:14px 28px;
      display:flex;align-items:center;gap:14px}
    .logo-txt{font-size:.8rem;font-weight:700;color:#f0f0f0;flex:1;letter-spacing:.02em}
    .status-pill{display:flex;align-items:center;gap:7px;padding:5px 12px;border-radius:20px;
      border:1px solid #333;background:#2a2a2a}
    .dot{width:9px;height:9px;border-radius:50%;flex-shrink:0;transition:all .5s}
    .dot.green{background:#2ecc71;box-shadow:0 0 10px #2ecc7199}
    .dot.red{background:#e74c3c;box-shadow:0 0 10px #e74c3c99}
    .dot.yellow{background:#f1c40f;box-shadow:0 0 10px #f1c40f99}
    .status-txt{font-size:.75rem;color:#ccc;font-weight:500}
    .hbtn{padding:7px 16px;border-radius:7px;border:1.5px solid #333;background:#2a2a2a;
      font-size:.78rem;font-weight:600;color:#ccc;cursor:pointer;transition:all .2s}
    .hbtn:hover{background:#333;color:#f0f0f0;border-color:#444}
    .hbtn.danger{border-color:#5a2020;color:#e05555}
    .hbtn.danger:hover{background:#2e1a1a;color:#ff7070;border-color:#7a2020}
    .hbtn.muted{border-color:#2a2a2a;color:#888}
    .hbtn.muted:hover{color:#ccc;border-color:#3a3a3a}

    .section-divider{border:none;border-top:1px solid #2e2e2e;margin:32px 0}

    /* Layout */
    main{max-width:1020px;margin:32px auto;padding:0 24px;display:flex;flex-direction:column;gap:0}
    .two-col{display:grid;grid-template-columns:1fr 1fr;gap:20px}
    @media(max-width:680px){.two-col{grid-template-columns:1fr}}

    /* Cards */
    .card{background:#222;border:1px solid #333;border-radius:12px;padding:26px}
    .card-label{font-size:.68rem;font-weight:700;color:#888;text-transform:uppercase;
      letter-spacing:.12em;margin-bottom:18px}

    /* QR */
    .qr-wrap{display:none;flex-direction:column;align-items:center;gap:14px}
    .qr-wrap.show{display:flex}
    .qr-wrap img{width:210px;height:210px;border-radius:8px;background:#fff;padding:8px}
    .qr-hint{font-size:.8rem;color:#999;text-align:center;line-height:1.5}

    /* Form */
    label{font-size:.75rem;font-weight:600;color:#aaa;display:block;margin-bottom:7px}
    input{width:100%;padding:12px 14px;border-radius:8px;border:1.5px solid #333;
      background:#2a2a2a;color:#f0f0f0;font-size:.92rem;margin-bottom:16px;transition:border .2s}
    input:focus{outline:none;border-color:#555}
    button.primary{width:100%;padding:13px;border-radius:8px;border:1.5px solid #3a3a3a;
      background:#2e2e2e;color:#f0f0f0;font-weight:700;font-size:.92rem;cursor:pointer;transition:all .2s}
    button.primary:hover{background:#383838;border-color:#4a4a4a}
    button.primary:disabled{opacity:.35;cursor:not-allowed}
    .spinner{display:inline-block;width:13px;height:13px;border:2.5px solid #444;
      border-top-color:#ccc;border-radius:50%;animation:spin .6s linear infinite;
      vertical-align:middle;margin-right:7px}
    @keyframes spin{to{transform:rotate(360deg)}}

    /* Preview */
    .preview{margin-top:20px;border:1px solid #333;border-radius:8px;overflow:hidden;display:none}
    .preview.show{display:block}
    .preview-head{background:#2a2a2a;padding:11px 16px;display:flex;align-items:center;gap:8px;
      border-bottom:1px solid #333}
    .preview-head .ok-icon{color:#2ecc71;font-weight:700;font-size:.85rem}
    .preview-head span{font-size:.82rem;color:#bbb;font-weight:600}
    .preview-body{padding:16px;display:flex;flex-direction:column;gap:14px}
    .field .field-lbl{font-size:.68rem;font-weight:700;color:#888;text-transform:uppercase;
      letter-spacing:.1em;margin-bottom:5px}
    .field .field-val{font-size:.88rem;background:#2a2a2a;border:1px solid #333;padding:9px 12px;
      border-radius:6px;font-family:'Courier New',monospace;word-break:break-all;color:#e8e8e8;
      line-height:1.4}
    .copy-btn{margin-top:6px;padding:4px 13px;border-radius:5px;border:1px solid #333;
      background:transparent;color:#999;font-size:.72rem;cursor:pointer;transition:all .2s}
    .copy-btn:hover{color:#ddd;border-color:#555;background:#2a2a2a}

    /* Method picker */
    .method-btn{flex:1;padding:12px 8px;border-radius:8px;border:1.5px solid #333;background:#2a2a2a;
      color:#aaa;font-size:.8rem;font-weight:600;cursor:pointer;transition:all .2s;text-align:center;line-height:1.8}
    .method-btn:hover{border-color:#444;color:#e0e0e0;background:#333}
    .method-btn.active{border-color:#555;background:#333;color:#f0f0f0}

    /* Settings */
    .settings-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
    .phone-prefix{font-size:.9rem;color:#aaa;font-weight:600;white-space:nowrap;padding:12px 10px 12px 0}
    .settings-row input{flex:1;min-width:140px;margin-bottom:0}
    .btn-save{padding:12px 20px;border-radius:8px;border:1.5px solid #3a3a3a;background:#2e2e2e;
      color:#f0f0f0;font-weight:700;font-size:.88rem;cursor:pointer;transition:all .2s;white-space:nowrap}
    .btn-save:hover{background:#383838;border-color:#4a4a4a}
    .settings-note{font-size:.75rem;color:#777;margin-top:10px}
    .settings-msg{font-size:.78rem;margin-top:10px;padding:8px 12px;border-radius:6px;display:none}
    .settings-msg.ok{color:#5c9;background:#1a2a1f;border:1px solid #2a4a30}
    .settings-msg.fail{color:#e05555;background:#2a1a1a;border:1px solid #442222}

    /* Error */
    .err-box{color:#e05555;font-size:.82rem;padding:10px 14px;border:1px solid #442222;
      border-radius:7px;margin-top:16px;display:none;background:#2a1a1a}

    /* Boletos browser */
    .back-btn{background:none;border:none;color:#777;font-size:.8rem;cursor:pointer;
      padding:0;margin-bottom:14px;display:inline-flex;align-items:center;gap:5px}
    .back-btn:hover{color:#e0e0e0}
    .files-header{font-size:.75rem;color:#666;margin-bottom:12px}
    .file-row{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:7px;
      border:1px solid #2e2e2e;margin-bottom:7px;background:#242424;transition:border .2s}
    .file-row:hover{border-color:#444}
    .file-venc{font-size:.82rem;font-weight:700;color:#e0e0e0;white-space:nowrap;min-width:80px}
    .file-nome{font-size:.78rem;color:#aaa;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .file-valor{font-size:.78rem;color:#7ec88a;white-space:nowrap;font-weight:600}
    .file-link{padding:4px 11px;border-radius:5px;border:1px solid #333;background:transparent;
      color:#888;font-size:.72rem;cursor:pointer;text-decoration:none;transition:all .2s;white-space:nowrap}
    .file-link:hover{color:#ddd;border-color:#555;background:#2a2a2a}
    .no-files{text-align:center;color:#555;font-size:.82rem;padding:24px 0}
    .search-folder-tag{font-size:.68rem;color:#555;background:#2a2a2a;border:1px solid #333;
      border-radius:4px;padding:2px 6px;white-space:nowrap}
    /* Calendar */
    .cal-nav{display:flex;align-items:center;gap:8px;margin-bottom:16px;flex-wrap:wrap}
    .cal-arrow{background:#2a2a2a;border:1px solid #333;border-radius:6px;color:#aaa;
      font-size:1rem;cursor:pointer;padding:5px 13px;transition:all .2s;line-height:1}
    .cal-arrow:hover{border-color:#555;color:#f0f0f0}
    .cal-month-label{font-size:.95rem;font-weight:700;color:#f0f0f0;flex:1;text-align:center}
    .cal-switch{display:flex;border:1px solid #333;border-radius:7px;overflow:hidden}
    .cal-sw{padding:5px 14px;background:#2a2a2a;border:none;color:#666;font-size:.75rem;
      font-weight:600;cursor:pointer;transition:all .2s}
    .cal-sw.active{background:#383838;color:#f0f0f0}
    .cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;margin-bottom:16px}
    .cal-dow{font-size:.6rem;color:#555;text-align:center;padding:4px 0;font-weight:700;text-transform:uppercase}
    .cal-day{min-height:52px;border-radius:7px;border:1px solid transparent;padding:5px 4px;
      display:flex;flex-direction:column;align-items:center;gap:3px;background:#1e1e1e}
    .cal-day.has-data{border-color:#2e2e2e;background:#232323;cursor:pointer}
    .cal-day.has-data:hover{border-color:#555;background:#2a2a2a}
    .cal-day.empty{background:transparent}
    .cal-day.today .cal-day-num{background:#333;border-radius:50%;width:22px;height:22px;
      display:flex;align-items:center;justify-content:center}
    .cal-day-num{font-size:.75rem;color:#666}
    .cal-day.has-data .cal-day-num{color:#ccc;font-weight:700}
    .cal-dot{width:5px;height:5px;border-radius:50%;background:#4a9eff}
    .cal-dot.emitidos{background:#3498db}
    .cal-dot.vencidos{background:#e67e22}
    .cal-dot.errors{background:#ff4d4d}
    .cal-count{font-size:.62rem;color:#7ec88a;font-weight:700}
    .cal-count.errors{color:#ff4d4d}
    .cal-status-pago{color:#2ecc71;font-size:.6rem;font-weight:700}
    .cal-status-aberto{color:#e74c3c;font-size:.6rem}
    
    .calendar-modes{display:flex;gap:5px;background:rgba(0,0,0,0.2);padding:3px;border-radius:7px;margin-left:auto}
    .mode-btn{border:none;background:transparent;color:#666;font-size:.7rem;font-weight:700;
      padding:4px 10px;border-radius:5px;cursor:pointer;transition:all .2s;text-transform:uppercase}
    .mode-btn.active{background:#2a2a2a;color:#efefef}
    .mode-btn.active#modeEmitidos{color:#3498db}
    .mode-btn.active#modeVencidos{color:#e67e22}
    .mode-btn.active#modeErrors{color:#ff4d4d}
  </style>
</head>
<body>
<header>
  <span class="logo-txt">Painel Boleto</span>
  <div class="status-pill">
    <div class="dot red" id="dot"></div>
    <span class="status-txt" id="statusTxt">Desconectado</span>
  </div>
  <button class="hbtn" onclick="connectWA()" id="btnConnect">Conectar</button>
  <button class="hbtn danger" onclick="disconnect()" id="btnDisconnect" style="display:none">Desconectar</button>
  <button class="hbtn muted" onclick="location.href='/painel-sair'">Sair</button>
</header>

<main>
  <div id="tab-principal">
    <div class="two-col" style="margin-bottom:20px">
      <div class="card">
        <p class="card-label">Recuperação de Senha</p>
        <div class="settings-row">
          <span class="phone-prefix">+55</span>
          <input type="tel" id="recoveryInput" placeholder="11999999988" maxlength="11"/>
          <button class="btn-save" onclick="salvarNumero()">Salvar</button>
        </div>
        <p class="settings-note" id="recoveryNote">Carregando...</p>
        <div class="settings-msg" id="settingsMsg"></div>
      </div>
      <div class="card">
        <p class="card-label">Notificação para Erros de Envio</p>
        <div class="settings-row">
          <span class="phone-prefix">+55</span>
          <input type="tel" id="notificationInput" placeholder="35991500311" maxlength="11"/>
          <button class="btn-save" onclick="salvarNotificacao()">Salvar</button>
        </div>
        <p class="settings-note" id="notificationNote">Carregando...</p>
        <div class="settings-msg" id="notificationMsg"></div>
      </div>
    </div>

    <div class="card" id="connectCard" style="display:none;margin-bottom:20px">
      <p class="card-label">Conectar WhatsApp</p>
      <div id="methodPicker" style="display:flex;gap:10px;margin-bottom:20px">
        <button class="method-btn active" id="btnMethodQR" onclick="setMethod('qr')">
          QR Code
        </button>
        <button class="method-btn" id="btnMethodCode" onclick="setMethod('code')">
          Código
        </button>
      </div>
      <div id="qrSection">
        <div class="qr-wrap show" id="qrBox">
          <p class="qr-hint">Clique em <strong>Conectar</strong> para gerar o QR Code</p>
        </div>
      </div>
      <div id="codeSection" style="display:none">
        <label>Seu número do WhatsApp</label>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
          <span style="color:#aaa;font-weight:600;white-space:nowrap">+55</span>
          <input type="tel" id="pairingPhone" placeholder="11999999988" maxlength="11" style="margin:0;flex:1"/>
        </div>
        <button class="primary" onclick="connectCode()">Gerar Código</button>
        <div id="pairingCodeBox" style="display:none;margin-top:20px;text-align:center">
          <p style="font-size:.75rem;color:#888;text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px">Digite este código no WhatsApp</p>
          <div style="font-size:2rem;font-weight:800;letter-spacing:.25em;color:#f0f0f0;
            background:#2a2a2a;border:1px solid #3a3a3a;border-radius:10px;padding:16px;
            font-family:'Courier New',monospace" id="pairingCodeDisplay">-</div>
          <p style="font-size:.75rem;color:#666;margin-top:10px">WhatsApp &rarr; Dispositivos conectados &rarr; Vincular com número de telefone</p>
        </div>
      </div>
    </div>

    <div class="two-col">
      <div class="card">
        <p class="card-label">Extrair Boleto - Retorno JSON</p>
        <label>URL do PDF</label>
        <input type="text" id="urlInput" placeholder="https://..."/>
        <button class="primary" id="btnExtrair" onclick="extrair()">Extrair Boleto</button>
        <div class="preview" id="preview">
          <div class="preview-head">
            <span class="ok-icon">v</span>
            <span>Dados extraídos com sucesso</span>
          </div>
          <div class="preview-body">
            <div class="field">
              <div class="field-lbl">Linha Digitável</div>
              <div class="field-val" id="rCodigo">-</div>
              <button class="copy-btn" onclick="copiar('rCodigo',this)">Copiar</button>
            </div>
            <div class="field">
              <div class="field-lbl">Valor</div>
              <div class="field-val" id="rValor">-</div>
            </div>
            <div class="field">
              <div class="field-lbl">Vencimento</div>
              <div class="field-val" id="rVencimento">-</div>
            </div>
            <div class="field">
              <div class="field-lbl">Pagador</div>
              <div class="field-val" id="rPagador">-</div>
            </div>
          </div>
        </div>
        <div class="err-box" id="errBox"></div>
      </div>

      <div class="card">
        <p class="card-label">Enviar Boleto via WhatsApp</p>
        <label>URL do PDF</label>
        <input type="text" id="sendUrl" placeholder="https://..."/>
        <label>Número de destino</label>
        <div style="display:flex;gap:8px;align-items:center">
          <span style="color:#aaa;font-weight:600;white-space:nowrap;padding:12px 10px 12px 0">+55</span>
          <input type="tel" id="sendPhone" placeholder="11999999988" maxlength="11" style="margin:0"/>
        </div>
        <button class="primary" id="btnEnviar" onclick="enviarWhats()" style="margin-top:16px">Enviar via WhatsApp</button>
        <div class="settings-msg" id="sendMsg"></div>
      </div>
    </div>
  </div>

  <hr class="section-divider"/>
  <!-- Arquivos -->
  <div id="tab-arquivos">
    <div class="card">
      <p class="card-label">Arquivos Salvos</p>
      <div class="cal-nav">
        <button class="cal-arrow" onclick="calPrev()">&#8249;</button>
        <span class="cal-month-label" id="calMonthLabel"></span>
        <button class="cal-arrow" onclick="calNext()">&#8250;</button>
        <div class="calendar-modes">
          <button id="modeEmitidos" class="mode-btn active" onclick="calSetMode('emitidos')">Emitidos</button>
          <button id="modeVencidos" class="mode-btn" onclick="calSetMode('vencidos')">Vencidos</button>
          <button id="modeErrors" class="mode-btn" onclick="calSetMode('errors')">Erros</button>
        </div>
      </div>
      <div class="cal-grid" id="calGrid"></div>
      <div id="calDetail" style="display:none">
        <button class="back-btn" onclick="backToCal()">[ Voltar ]</button>
        <p class="files-header" id="calDetailHeader"></p>
        <div id="calDetailList"></div>
      </div>
      <hr style="border:none;border-top:1px solid #2a2a2a;margin:16px 0"/>
      <input type="text" id="boletoSearch" placeholder="Pesquisar por pedido, pagador, hash..."
        style="margin-bottom:0" oninput="debouncedSearch()"/>
      <div id="searchResults" style="display:none;margin-top:12px"></div>
    </div>
  </div>
</main>

<script>
  console.log('Dashboard Script: Carregando...');
  let qrPoller = null;

  // --- Configuracoes ---
  async function loadSettings() {
    try {
      const res = await fetch('/settings');
      if (!res.ok) throw new Error();
      const d = await res.json();
      if (d.recoveryPhone) {
        document.getElementById('recoveryInput').value = d.recoveryPhone;
        document.getElementById('recoveryNote').textContent = 'Número atual: +55 ' + d.recoveryPhone;
      } else {
        document.getElementById('recoveryNote').textContent = 'Padrão: Número conectado.';
      }
      if (d.notificationPhone) {
        document.getElementById('notificationInput').value = d.notificationPhone;
        document.getElementById('notificationNote').textContent = 'Número atual: +55 ' + d.notificationPhone;
      } else {
        document.getElementById('notificationNote').textContent = 'Nenhum número configurado.';
      }
    } catch(e) {
      document.getElementById('recoveryNote').textContent = 'Erro ao carregar configurações.';
      document.getElementById('notificationNote').textContent = 'Erro ao carregar configurações.';
    }
  }

  loadSettings();

  async function salvarNumero() {
    const val = document.getElementById('recoveryInput').value.trim().replace(/\D/g,'');
    const msg = document.getElementById('settingsMsg');
    const res = await fetch('/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recoveryPhone:val})});
    const d = await res.json();
    msg.className = 'settings-msg ' + (res.ok ? 'ok' : 'fail');
    msg.textContent = res.ok ? 'Número salvo: +55 ' + d.recoveryPhone : (d.error||'Erro ao salvar.');
    msg.style.display = 'block';
    if (res.ok) document.getElementById('recoveryNote').textContent = 'Número atual: +55 ' + d.recoveryPhone;
    setTimeout(()=>msg.style.display='none', 3000);
  }

  async function salvarNotificacao() {
    const val = document.getElementById('notificationInput').value.trim().replace(/\D/g,'');
    const msg = document.getElementById('notificationMsg');
    const res = await fetch('/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({notificationPhone:val})});
    const d = await res.json();
    msg.className = 'settings-msg ' + (res.ok ? 'ok' : 'fail');
    msg.textContent = res.ok ? 'Número salvo: +55 ' + d.notificationPhone : (d.error||'Erro ao salvar.');
    msg.style.display = 'block';
    if (res.ok) document.getElementById('notificationNote').textContent = 'Número atual: +55 ' + d.notificationPhone;
    setTimeout(()=>msg.style.display='none', 3000);
  }

  async function pollStatus() {
    try {
      const d = await fetch('/qr').then(r=>r.json());
      const dot         = document.getElementById('dot');
      const txt         = document.getElementById('statusTxt');
      const btnC        = document.getElementById('btnConnect');
      const btnD        = document.getElementById('btnDisconnect');
      const connectCard = document.getElementById('connectCard');
      const qrBox       = document.getElementById('qrBox');

      if (d.connected) {
        dot.className = 'dot green';
        txt.textContent = 'Conectado';
        btnC.style.display = 'none';
        btnD.style.display = '';
        connectCard.style.display = 'none';
        connectCardOpen = false;
        stopQrPoller();
      } else if (d.connecting) {
        dot.className = 'dot yellow';
        txt.textContent = d.pairingCode ? 'Aguardando código...' : 'Aguardando QR...';
        if (d.qr) {
          qrBox.innerHTML = '<img src="'+d.qr+'"/><p class="qr-hint">Abra o WhatsApp no celular<br>Dispositivos conectados → Conectar dispositivo</p>';
        }
        if (d.pairingCode) {
          document.getElementById('pairingCodeDisplay').textContent = d.pairingCode;
        }
      } else {
        dot.className = 'dot red';
        txt.textContent = 'Desconectado';
        btnC.style.display = '';
        btnD.style.display = 'none';
        // Só fecha o card se o usuário não o abriu explicitamente
        if (!connectCardOpen) connectCard.style.display = 'none';
      }
    } catch(_) {}
  }

  function startQrPoller() { if(qrPoller)return; pollStatus(); qrPoller=setInterval(pollStatus,2500); }
  function stopQrPoller()  { clearInterval(qrPoller); qrPoller=null; }

  setInterval(pollStatus, 5000);
  pollStatus();

  let connectMethod = 'qr';
  let connectCardOpen = false;

  function setMethod(m) {
    connectMethod = m;
    document.getElementById('btnMethodQR').className   = 'method-btn' + (m==='qr'   ? ' active' : '');
    document.getElementById('btnMethodCode').className = 'method-btn' + (m==='code' ? ' active' : '');
    document.getElementById('qrSection').style.display   = m==='qr'   ? '' : 'none';
    document.getElementById('codeSection').style.display = m==='code' ? '' : 'none';
  }

  async function connectWA() {
    connectCardOpen = true;
    document.getElementById('connectCard').style.display = 'block';
    if (connectMethod === 'qr') {
      await fetch('/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method:'qr'})});
      startQrPoller();
    }
  }

  async function connectCode() {
    const phone = document.getElementById('pairingPhone').value.trim();
    if (!phone) return;
    await fetch('/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method:'code',phone})});
    document.getElementById('pairingCodeDisplay').textContent = '...';
    document.getElementById('pairingCodeBox').style.display = 'block';
    startQrPoller();
  }

  async function disconnect() {
    const d = await fetch('/status').then(r=>r.json());
    const num = d.phone ? '+55 ' + d.phone : 'este número';
    if (!confirm('Deseja desconectar ' + num + ' do painel?\\n\\nVocê precisará escanear o QR novamente para reconectar.')) return;
    connectCardOpen = false;
    await fetch('/disconnect',{method:'POST'});
    pollStatus();
  }

  async function extrair() {
    const url    = document.getElementById('urlInput').value.trim();
    const btn    = document.getElementById('btnExtrair');
    const preview = document.getElementById('preview');
    const errBox = document.getElementById('errBox');
    preview.classList.remove('show');
    errBox.style.display = 'none';
    if (!url) { showErr('Informe a URL do boleto.'); return; }
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Extraindo...';
    try {
      const res = await fetch('/extract-boleto',{method:'POST',
        headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});
      const d = await res.json();
      if (!res.ok) { showErr(d.error||'Erro ao extrair.'); return; }
      document.getElementById('rCodigo').textContent     = d.codigoBarras;
      document.getElementById('rValor').textContent      = d.valor;
      document.getElementById('rVencimento').textContent = d.vencimento;
      document.getElementById('rPagador').textContent    = d.pagador || '—';

      preview.classList.add('show');
    } catch(e) { showErr('Erro de conexão com o servidor.'); }
    finally { btn.disabled=false; btn.textContent='Extrair Boleto'; }
  }

  function showErr(msg) {
    const el = document.getElementById('errBox');
    el.textContent = msg; el.style.display = 'block';
  }

  async function enviarWhats() {
    const url   = document.getElementById('sendUrl').value.trim();
    const phone = document.getElementById('sendPhone').value.trim().replace(/\D/g,'');
    const msg   = document.getElementById('sendMsg');
    const btn   = document.getElementById('btnEnviar');
    if (!url)   { msg.className='settings-msg fail'; msg.textContent='Informe a URL do boleto.'; msg.style.display='block'; setTimeout(()=>msg.style.display='none',3000); return; }
    if (!phone) { msg.className='settings-msg fail'; msg.textContent='Informe o número de destino.'; msg.style.display='block'; setTimeout(()=>msg.style.display='none',3000); return; }
    btn.disabled = true; btn.textContent = 'Enviando...';
    try {
      const res = await fetch('/send-boletos',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({phone, boletos:[{url}]})});
      const d = await res.json();
      msg.className = 'settings-msg ' + (res.ok ? 'ok' : 'fail');
      msg.textContent = res.ok ? 'Enviado com sucesso!' : (d.error||'Erro ao enviar.');
    } catch(e) { msg.className='settings-msg fail'; msg.textContent='Erro de conexão.'; }
    msg.style.display = 'block';
    setTimeout(()=>msg.style.display='none', 4000);
    btn.disabled = false; btn.textContent = 'Enviar via WhatsApp';
  }

  function copiar(id, btn) {
    const txt = document.getElementById(id).textContent;
    navigator.clipboard.writeText(txt).then(function() {
      btn.textContent = 'Copiado!';
      setTimeout(function() { btn.textContent = 'Copiar'; }, 1800);
    });
  }

  // --- Calendar ---
  var calYear  = new Date().getFullYear();
  var calMonth = new Date().getMonth(); // 0-based
  var calMode = 'emitidos'; // 'emitidos', 'vencidos' ou 'errors'
  var calData = [];
  var calErrors = [];
  var MONTHS_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
    'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  function calFolderStr() {
    return String(calMonth + 1).padStart(2, '0') + '-' + calYear;
  }

  async function loadCalendar() {
    var monthStr = String(calMonth + 1).padStart(2, '0');
    var query = calYear + '-' + monthStr;
    document.getElementById('calMonthLabel').textContent = MONTHS_PT[calMonth] + ' ' + calYear;
    try {
      calData = await fetch('/api/boletos/search?q=' + query).then(res => res.json());
      calErrors = await fetch('/api/boletos/errors').then(res => res.json());
      renderCalendar();
    } catch(e) { 
      console.error('Erro ao carregar dados do calendário:', e); 
      calData = []; calErrors = []; renderCalendar(); 
    }
  }

  function renderCalendar() {
    var grid = document.getElementById('calGrid');
    var today = new Date();
    var daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    var firstDay    = new Date(calYear, calMonth, 1).getDay();
    var dateField   = calMode === 'emitidos' ? 'dataemissao' : 'datavenc';
    var currentMonthStr = String(calMonth + 1).padStart(2, '0');
    var currentYearStr  = String(calYear);

    var dows = ['Dom','Seg','Ter','Qua','Qui','Sex','Sab'];
    var html = dows.map(function(d) { return '<div class="cal-dow">' + d + '</div>'; }).join('');

    for (var i = 0; i < firstDay; i++) html += '<div class="cal-day empty"></div>';

    for (var d = 1; d <= daysInMonth; d++) {
      var dayStr  = (d < 10 ? '0' : '') + d;
      var fullDate = currentYearStr + '-' + currentMonthStr + '-' + dayStr;
      var isToday = (today.getFullYear() === calYear && today.getMonth() === calMonth && today.getDate() === d);

      var itemsOnDay = calData.filter(function(e) {
        if (calMode === 'errors') return false;
        return (e[dateField] || '').startsWith(fullDate);
      });
      var errorsOnDay = calErrors.filter(function(e) { return e.date === fullDate; });

      var count = itemsOnDay.length;
      var errorCount = errorsOnDay.length;

      var dotHtml = '';
      if (count > 0) {
        dotHtml += '<div class="cal-dot ' + calMode + '"></div>';
      }
      if (errorCount > 0) {
        dotHtml += '<div class="cal-dot errors"></div>';
      }

      var dayClass = 'cal-day';
      if (isToday) dayClass += ' today';
      if (count > 0 || errorCount > 0) dayClass += ' has-data';

      var onclick = '';
      if (count > 0 || errorCount > 0) {
        onclick = 'onclick="calViewDay(\'' + fullDate + '\')"';
      }

      html += '<div class="' + dayClass + '" ' + onclick + '>' +
        '<span class="cal-day-num">' + d + '</span>' +
        dotHtml +
        (count > 0 && calMode !== 'errors' ? '<span class="cal-count">' + count + '</span>' : '') +
        (errorCount > 0 && calMode === 'errors' ? '<span class="cal-count errors">' + errorCount + '</span>' : '') +
      '</div>';
    }
    grid.innerHTML = html;
  }

  function calPrev() {
    calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
    backToCal(); loadCalendar();
  }
  function calNext() {
    calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
    backToCal(); loadCalendar();
  }
  function calSetMode(m) {
    calMode = m;
    document.getElementById('modeEmitidos').classList.toggle('active', m === 'emitidos');
    document.getElementById('modeVencidos').classList.toggle('active', m === 'vencidos');
    document.getElementById('modeErrors').classList.toggle('active', m === 'errors');
    backToCal();
    renderCalendar();
  }

  function calViewDay(dateStr) {
    var items = [];
    var isErrors = (calMode === 'errors');
    if (isErrors) {
      items = calErrors.filter(function(e) { return e.date === dateStr; });
    } else {
      var field = (calMode === 'emitidos') ? 'dataemissao' : 'datavenc';
      items = calData.filter(function(e) { return (e[field] || '') === dateStr; });
    }
    
    if (!items.length) return;

    var label = isErrors ? 'Falhas na Extração' : (calMode === 'emitidos' ? 'Boleto(s) Emitido(s)' : 'Boleto(s) Vencendo');
    var d = dateStr.split('-').reverse().join('/');
    
    document.getElementById('calDetailHeader').textContent = d + ' — ' + label + ' (' + items.length + ')';
    document.getElementById('calDetailList').innerHTML = items.map(function(item) {
      if (isErrors) return errorRowHtml(item);
      return sitemapRowHtml(item);
    }).join('');
    
    document.getElementById('calDetail').style.display = 'block';
    document.getElementById('calDetail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function errorRowHtml(e) {
    var p = e.npedido || 'N/D';
    return '<div class="file-row" style="border-left: 4px solid #ff4d4d; background: rgba(255,77,77,0.05);">' +
      '<span class="file-venc" style="color:#ff4d4d">FALHA</span>' +
      '<span class="file-nome">Pedido: ' + p + '</span>' +
      '<span class="file-valor" style="font-size:0.8em; flex: 2; opacity: 0.8; overflow:hidden; text-overflow:ellipsis;">' + e.reason + '</span>' +
      '<a class="file-link" href="' + e.url + '" target="_blank">Bling ></a>' +
    '</div>';
  }

  function backToCal() {
    document.getElementById('calDetail').style.display = 'none';
  }

  function sitemapRowHtml(f) {
    var venc   = f.datavenc ? f.datavenc.split('-').reverse().join('/') : '-';
    var status = f.status === 'pago'
      ? '<span class="cal-status-pago">PAGO</span>'
      : '<span class="cal-status-aberto">aberto</span>';
    var n = f.pagador || f.npedido || '-';
    return '<div class="file-row">' +
      '<span class="file-venc">' + venc + '</span>' +
      '<span class="file-nome">' + n + '</span>' +
      '<span class="file-valor">' + (f.valor || '') + '</span>' +
      status +
      '<a class="file-link" href="' + f.url + '" target="_blank">Abrir</a>' +
    '</div>';
  }

  // --- Search ---
  var searchTimer = null;
  function debouncedSearch() {
    clearTimeout(searchTimer);
    var q = document.getElementById('boletoSearch').value.trim();
    if (!q) { loadRecent(); return; }
    searchTimer = setTimeout(runSearch, 350);
  }

  async function runSearch() {
    var q = document.getElementById('boletoSearch').value.trim();
    if (!q) { loadRecent(); return; }
    var sr = document.getElementById('searchResults');
    sr.style.display = 'block';
    sr.innerHTML = '<div class="no-files">Buscando...</div>';
    try {
      var results = await fetch('/api/boletos/search?q=' + encodeURIComponent(q)).then(r => r.json());
      if (!results.length) { sr.innerHTML = '<div class="no-files">Nenhum resultado.</div>'; return; }
      sr.innerHTML = '<p class="files-header">' + results.length + ' resultado' + (results.length !== 1 ? 's' : '') + '</p>' +
        results.map(sitemapRowHtml).join('');
    } catch(e) { sr.innerHTML = '<div class="no-files">Erro na busca.</div>'; }
  }

  async function loadRecent() {
    var sr = document.getElementById('searchResults');
    sr.style.display = 'block';
    try {
      var results = await fetch('/api/boletos/recent').then(r => r.json());
      if (!results.length) { sr.style.display = 'none'; return; }
      sr.innerHTML = '<p class="files-header">Últimos boletos processados</p>' +
        results.map(sitemapRowHtml).join('');
    } catch(e) { sr.style.display = 'none'; }
  }

  loadCalendar();
  loadRecent();

  // Expoe funcoes para handlers HTML inline
  window.salvarNumero      = salvarNumero;
  window.salvarNotificacao = salvarNotificacao;
  window.connectWA         = connectWA;
  window.connectCode       = connectCode;
  window.disconnect        = disconnect;
  window.setMethod         = setMethod;
  window.extrair           = extrair;
  window.copiar            = copiar;
  window.enviarWhats       = enviarWhats;
  window.debouncedSearch   = debouncedSearch;
  window.backToCal         = backToCal;
  window.calViewDay        = calViewDay;
  window.calPrev           = calPrev;
  window.calNext           = calNext;
  window.calSetMode        = calSetMode;
</script>
</body></html>`;

// ─── Routes ──────────────────────────────────────────────────────────

app.get('/painel', (req, res) => {
  if (sessions.has(req.cookies?.token)) return res.redirect('/');
  res.send(loginHTML());
});

app.post('/painel', (req, res) => {
  const { password, remember } = req.body;
  if (password === PASSWORD) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.add(token);
    saveSessions();
    const maxAge = remember ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    res.cookie('token', token, { httpOnly: true, maxAge });
    return res.json({ success: true });
  }
  res.status(401).json({ error: 'Senha incorreta.' });
});

app.get('/painel-sair', (req, res) => {
  sessions.delete(req.cookies?.token);
  saveSessions();
  res.clearCookie('token');
  res.redirect('/painel');
});

app.get('/', auth, (req, res) => res.send(dashboardHTML()));

app.get('/status', (req, res) => {
  res.json({ connected: waReady, connecting: waConnecting, phone: waPhone });
});

app.get('/qr', auth, (req, res) => {
  res.json({
    qr: waQR,
    pairingCode: waPairingCode,
    connecting: waConnecting || !!waPairingCode,
    connected: waReady,
  });
});

app.post('/connect', auth, async (req, res) => {
  const { method, phone } = req.body || {};

  // Se já está conectado, não faz nada
  if (waReady) return res.json({ success: true, already: true });

  // Para qualquer tentativa anterior em curso
  try { await waSocket?.end?.(); } catch (_) { }
  waSocket = null;
  waConnecting = false;
  waQR = null;
  waPairingCode = null;

  // Limpa sessão incompleta (creds com registered:false bloqueiam nova tentativa)
  try {
    const creds = JSON.parse(fs.readFileSync('./auth_info/creds.json', 'utf8'));
    if (!creds.registered) fs.rmSync('./auth_info', { recursive: true, force: true });
  } catch (_) {
    // sem auth_info ou creds inválido — limpa por segurança
    fs.rmSync('./auth_info', { recursive: true, force: true });
  }

  if (method === 'code') {
    if (!phone || phone.replace(/\D/g, '').length < 10) {
      return res.status(400).json({ error: 'Informe um número válido com DDD.' });
    }
    connectWhatsApp(phone);
  } else {
    connectWhatsApp();
  }
  res.json({ success: true });
});

app.post('/disconnect', auth, async (req, res) => {
  await disconnectWhatsApp();
  res.json({ success: true });
});

// Extrai vários boletos e envia mensagem formatada via WhatsApp
app.post('/send-boletos', async (req, res) => {
  const { phone, nome, referencia, boletos } = req.body || {};
  if (!phone || !Array.isArray(boletos) || boletos.length === 0)
    return res.status(400).json({ error: 'Informe phone e boletos[].' });
  if (!waReady)
    return res.status(503).json({ error: 'WhatsApp não está conectado.' });

  // Extrai vencimento e pagador de cada boleto
  const dados = [];
  for (const b of boletos) {
    try {
      const pdf = await axios.get(b.url, {
        responseType: 'arraybuffer', timeout: 30000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BoletoExtractor/1.0)' },
      });
      const pdfBuffer = Buffer.from(pdf.data);
      const parsed = await pdfParse(pdfBuffer);
      const text = parsed.text;
      const codigoBarras = extractCodigoBarras(text);
      const venc = extractVencimento(text) || null;
      const valor = extractValor(text, codigoBarras) || null;
      savePdfLocally(b.url, pdfBuffer, venc);
      dados.push({
        url: b.url,
        vencimento: venc || 'N/D',
        valor: valor || null,
        pagador: extractPagador(text) || null,
      });
    } catch (e) {
      let boletoId;
      try { boletoId = new URL(b.url).searchParams.get('id') || b.url; } catch (_) { boletoId = b.url; }
      const notifNum = (config.notificationPhone || ADMIN_PHONE).replace(/\D/g, '');
      const adminJid = (notifNum.startsWith('55') ? notifNum : `55${notifNum}`) + '@s.whatsapp.net';
      const errMsg = `⚠️ Erro ao extrair boleto\n\nID: ${boletoId}\nMotivo: ${e.message}\n\nURL:\n${b.url}`;
      try { await waSocket.sendMessage(adminJid, { text: errMsg }); } catch (_) { }
      return res.status(502).json({ error: `Falha ao extrair boleto ${boletoId}: ${e.message}` });
    }
  }

  const n = dados.length;
  const nomeFinal = nome || dados[0]?.pagador || null;
  const saudacao = nomeFinal ? `Olá *${nomeFinal}*, tudo bem?` : `Olá, tudo bem?`;
  const subtitulo = referencia
    ? `Seguem os boletos ref. a compra ${referencia}...`
    : `Seguem os boletos em aberto...`;

  const boletosFormatados = dados
    .map((d, i) => `(${i + 1}/${n}) - Venc: ${d.vencimento}${d.valor ? ` - ${d.valor}` : ''}\n${d.url}`)
    .join('\n\n');

  let totalStr = '';
  if (n > 1) {
    const total = dados.reduce((sum, d) => {
      const num = parseFloat((d.valor || '').replace(/[^\d,]/g, '').replace(',', '.'));
      return sum + (isNaN(num) ? 0 : num);
    }, 0);
    if (total > 0) totalStr = `\n\nTotal: ${total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`;
  }

  const msg = `${saudacao}\n${subtitulo}\n\n${boletosFormatados}${totalStr}`;

  const digits = phone.replace(/\D/g, '');
  const jid = (digits.startsWith('55') ? digits : `55${digits}`) + '@s.whatsapp.net';
  try {
    await waSocket.sendMessage(jid, { text: msg });
    res.json({ success: true, parcelas: n });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Envia mensagem de texto via WhatsApp — sem autenticação (uso interno/N8N)
app.post('/send-message', async (req, res) => {
  const { phone, message } = req.body || {};
  if (!phone || !message) return res.status(400).json({ error: 'Informe phone e message.' });
  if (!waReady) return res.status(503).json({ error: 'WhatsApp não está conectado.' });
  const digits = phone.replace(/\D/g, '');
  const jid = (digits.startsWith('55') ? digits : `55${digits}`) + '@s.whatsapp.net';
  try {
    await waSocket.sendMessage(jid, { text: message });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/forgot-password', (req, res) => {
  if (!waReady) {
    return res.status(503).json({ error: 'WhatsApp não está conectado no momento.' });
  }
  const dest = config.recoveryPhone;
  if (!dest) {
    return res.status(400).json({ error: 'Nenhum número de recuperação configurado no painel.' });
  }
  res.json({ success: true });
  setTimeout(async () => {
    try {
      const jid = `55${dest.replace(/\D/g, '')}@s.whatsapp.net`;
      await waSocket.sendMessage(jid, {
        text: `🔐 *Senha do painel:*\n\n\`${PASSWORD}\`\n\n_Mensagem automática — Painel Boleto_`,
      });
    } catch (e) { console.error('Erro ao enviar senha:', e.message); }
  }, 3 * 60 * 1000);
});

app.get('/settings', auth, (req, res) => {
  res.json({
    recoveryPhone: config.recoveryPhone || '',
    notificationPhone: config.notificationPhone || '',
  });
});

app.post('/settings', auth, (req, res) => {
  const { recoveryPhone, notificationPhone } = req.body;

  if (recoveryPhone !== undefined) {
    const digits = (recoveryPhone || '').replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 11)
      return res.status(400).json({ error: 'Número inválido. Use DDD + número (10 ou 11 dígitos).' });
    config.recoveryPhone = digits;
    saveConfig();
    return res.json({ success: true, recoveryPhone: digits });
  }

  if (notificationPhone !== undefined) {
    const digits = (notificationPhone || '').replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 11)
      return res.status(400).json({ error: 'Número inválido. Use DDD + número (10 ou 11 dígitos).' });
    config.notificationPhone = digits;
    saveConfig();
    return res.json({ success: true, notificationPhone: digits });
  }

  res.status(400).json({ error: 'Nenhum campo reconhecido.' });
});

// ─── Extração ────────────────────────────────────────────────────────

function extractPagador(text) {
  const lines = text.split('\n').map(l => l.trim());

  // Localiza o índice do último label "Pagador" no texto
  let lastPagadorIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === 'Pagador') lastPagadorIdx = i;
  }
  if (lastPagadorIdx === -1) return null;

  // Após o último "Pagador", pega a primeira linha seguida de "CNPJ/CPF"
  // que não comece com dígito (exclui números de documento/CNPJ inline)
  for (let i = lastPagadorIdx + 1; i < lines.length - 1; i++) {
    const line = lines[i];
    const next = lines[i + 1];
    if (next.startsWith('CNPJ/CPF') && line.length > 2 && !/^\d/.test(line)) {
      return line;
    }
  }
  return null;
}

function extractCodigoBarras(text) {
  const patterns = [
    /\d{5}\.\d{5}\s+\d{5}\.\d{6}\s+\d{5}\.\d{6}\s+\d\s+\d{14}/,
    /\b\d{47,48}\b/,
    /\d[\d\s\.]{44,60}\d/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[0].replace(/\s+/g, ' ').trim();
  }
  return null;
}

function extractValor(text, codigoBarras) {
  const patterns = [/R\$\s*[\d.,]+/i, /valor[:\s]+R?\$?\s*[\d.,]+/i, /total[:\s]+R?\$?\s*[\d.,]+/i];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[0].trim();
  }
  if (codigoBarras) {
    const campo5 = codigoBarras.match(/\b(\d{14})\b/);
    if (campo5) {
      const centavos = parseInt(campo5[1].slice(4), 10);
      if (centavos > 0)
        return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }
  }
  return null;
}


function extractVencimento(text) {
  const patterns = [
    /vencimento[:\s]+(\d{2}[\/\-]\d{2}[\/\-]\d{4})/i,
    /data\s+de\s+vencimento[:\s]+(\d{2}[\/\-]\d{2}[\/\-]\d{4})/i,
    /(\d{2}[\/\-]\d{2}[\/\-]\d{4})/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1] || m[0];
  }
  return null;
}

app.post('/extract-boleto', async (req, res) => {
  const url         = req.body.url || req.query.url;
  const npedido     = req.body.npedido || req.query.npedido || null;
  const dataemissao = req.body.dataemissao || req.query.dataemissao || null;
  if (!url) return res.status(400).json({ error: 'Campo "url" é obrigatório.' });

  try {
    let hash;
    try {
      const parsed = new URL(url);
      hash = parsed.searchParams.get('id') || parsed.pathname.split('/').filter(Boolean).pop();
    } catch (_) {
      hash = crypto.createHash('md5').update(url).digest('hex').slice(0, 8);
    }

    if (fs.existsSync(BOLETOS_DIR)) {
      const folders = fs.readdirSync(BOLETOS_DIR).filter(n => /^\d{2}-\d{4}$/.test(n));
      for (const folder of folders) {
        const entries = loadSitemap(folder);
        const entry = entries.find(e => (e.hash && e.hash.includes(hash)) || (e.url && e.url.includes(hash)));
        if (entry) {
          console.log(`[cache] boleto encontrado localmente: ${hash}`);
          return res.json({
            ...entry,
            cached: true,
            codigoBarras: entry.codigoBarras || null,
            vencimento: entry.datavenc || 'N/D',
            valor: entry.valor || 'N/D'
          });
        }
      }
    }

    const response = await axios.get(url, {
      responseType: 'arraybuffer', timeout: 30000,
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/pdf,*/*'
      },
    });
    
    const pdfBuffer = Buffer.from(response.data);
    
    // Função auxiliar para salvar erros de extração
    function saveExtractionError(url, npedido, dataemissao, reason) {
        const ERR_FILE = path.join(BOLETOS_DIR, 'errors.json');
        let list = [];
        if (fs.existsSync(ERR_FILE)) {
            try { list = JSON.parse(fs.readFileSync(ERR_FILE, 'utf8')); } catch(e) {}
        }
        const now = new Date();
        const dateKey = now.toISOString().split('T')[0]; // YYYY-MM-DD
        list.push({ url, npedido, dataemissao, reason, timestamp: now.toISOString(), date: dateKey });
        
        // Mantém apenas os últimos 500 erros
        if (list.length > 500) list.shift();
        fs.writeFileSync(ERR_FILE, JSON.stringify(list, null, 2));
    }

    // Verifica se o que baixamos começa com %PDF-. Se não, é erro ou HTML.
    if (!pdfBuffer.slice(0, 4).toString().includes('%PDF')) {
      saveExtractionError(url, npedido, dataemissao, 'Bling não retornou um PDF válido (provavelmente link expirado ou de teste).');
      return res.status(422).json({ 
        error: 'O link não retornou um arquivo PDF válido.', 
        details: 'Erro registrado no log do painel.' 
      });
    }

    const pdfData = await pdfParse(pdfBuffer);
    const text = pdfData.text;

    const codigoBarras = extractCodigoBarras(text);
    const valor = extractValor(text, codigoBarras);
    const vencimento = extractVencimento(text);
    const pagador = extractPagador(text);

    savePdfLocally(url, pdfBuffer, { npedido, dataemissao, pagador, valor, datavenc: vencimento, codigoBarras });

    return res.json({
      codigoBarras,
      valor: valor || 'Não encontrado',
      vencimento: vencimento || 'Não encontrado',
      pagador:    pagador    || null,
      cached:     false
    });
  } catch (err) {
    console.error('[extract] erro:', err.message);
    const npedido = req.body.npedido || req.query.npedido || null;
    const dataemissao = req.body.dataemissao || req.query.dataemissao || null;
    
    // Salva erro crítico também
    const ERR_FILE = path.join(BOLETOS_DIR, 'errors.json');
    let list = [];
    if (fs.existsSync(ERR_FILE)) {
        try { list = JSON.parse(fs.readFileSync(ERR_FILE, 'utf8')); } catch(e) {}
    }
    list.push({ url, npedido, dataemissao, reason: err.message, timestamp: new Date().toISOString(), date: new Date().toISOString().split('T')[0] });
    if (list.length > 500) list.shift();
    fs.writeFileSync(ERR_FILE, JSON.stringify(list, null, 2));

    if (err.response) return res.status(502).json({ error: `Erro ao baixar PDF: HTTP ${err.response.status}` });
    return res.status(500).json({ error: `Erro interno: ${err.message}` });
  }
});

app.get('/api/boletos/errors', auth, (req, res) => {
  try {
    const ERR_FILE = path.join(BOLETOS_DIR, 'errors.json');
    if (!fs.existsSync(ERR_FILE)) return res.json([]);
    const list = JSON.parse(fs.readFileSync(ERR_FILE, 'utf8'));
    res.json(list);
  } catch(e) { res.json([]); }
});

// ─── Boleto por hash ─────────────────────────────────────────────────
app.get('/api/boleto/:hash', (req, res) => {
  try {
    const hash = req.params.hash;
    if (!fs.existsSync(BOLETOS_DIR)) return res.status(404).json({ error: 'Nenhum boleto salvo.' });
    for (const folder of fs.readdirSync(BOLETOS_DIR).filter(n => /^\d{2}-\d{4}$/.test(n))) {
      const entry = loadSitemap(folder).find(e => e.hash && e.hash.includes(hash));
      if (entry) return res.json(entry);
    }
    res.status(404).json({ error: 'Boleto não encontrado.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Sitemap / pedido / abertos / status ─────────────────────────────
app.get('/api/sitemap/:month', (req, res) => {
  const { month } = req.params;
  if (!/^\d{2}-\d{4}$/.test(month)) return res.status(400).json({ error: 'Use MM-YYYY.' });
  res.json(loadSitemap(month));
});

app.get('/api/boletos/abertos', (req, res) => {
  try {
    if (!fs.existsSync(BOLETOS_DIR)) return res.json([]);
    const results = [];
    fs.readdirSync(BOLETOS_DIR).filter(n => /^\d{2}-\d{4}$/.test(n))
      .forEach(folder => loadSitemap(folder).filter(e => e.status === 'aberto').forEach(e => results.push(e)));
    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/boleto/:hash/status', (req, res) => {
  try {
    const { hash } = req.params;
    const { status, datapgt } = req.body;
    if (!fs.existsSync(BOLETOS_DIR)) return res.status(404).json({ error: 'Não encontrado.' });
    for (const folder of fs.readdirSync(BOLETOS_DIR).filter(n => /^\d{2}-\d{4}$/.test(n))) {
      const entries = loadSitemap(folder);
      const idx = entries.findIndex(e => e.hash && e.hash.includes(hash));
      if (idx >= 0) {
        if (status) entries[idx].status = status;
        if (datapgt) entries[idx].datapgt = datapgt;
        fs.writeFileSync(sitemapPath(folder), JSON.stringify(entries, null, 2));
        return res.json(entries[idx]);
      }
    }
    res.status(404).json({ error: 'Boleto não encontrado.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/pedido/:npedido', (req, res) => {
  try {
    if (!fs.existsSync(BOLETOS_DIR)) return res.json([]);
    const results = [];
    fs.readdirSync(BOLETOS_DIR).filter(n => /^\d{2}-\d{4}$/.test(n))
      .forEach(folder => loadSitemap(folder).filter(e => e.npedido === req.params.npedido).forEach(e => results.push(e)));
    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Boletos browser API ─────────────────────────────────────────────
app.get('/api/boletos/folders', auth, (req, res) => {
  try {
    if (!fs.existsSync(BOLETOS_DIR)) return res.json([]);
    const folders = fs.readdirSync(BOLETOS_DIR)
      .filter(n => /^\d{2}-\d{4}$/.test(n))
      .map(folder => {
        let count = 0;
        try { count = fs.readdirSync(path.join(BOLETOS_DIR, folder)).filter(f => f.endsWith('.pdf')).length; } catch (_) { }
        return { folder, count };
      })
      .sort((a, b) => {
        const [am, ay] = a.folder.split('-').map(Number);
        const [bm, by] = b.folder.split('-').map(Number);
        return (by * 12 + bm) - (ay * 12 + am);
      });
    res.json(folders);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/boletos/files/:folder', auth, (req, res) => {
  try {
    const folder = req.params.folder;
    if (!/^\d{2}-\d{4}$/.test(folder)) return res.status(400).json({ error: 'Pasta inválida.' });
    const dir = path.join(BOLETOS_DIR, folder);
    if (!fs.existsSync(dir)) return res.json([]);
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.pdf'))
      .map(name => {
        const m = name.match(/^(\d{2})(\d{2})(\d{4})-(.+)\.pdf$/);
        const stat = fs.statSync(path.join(dir, name));
        let pagador = null, valor = null;
        try { const md = JSON.parse(fs.readFileSync(path.join(dir, name.replace(/\.pdf$/, '.json')), 'utf8')); pagador = md.pagador || null; valor = md.valor || null; } catch (_) { }
        return {
          name,
          venc: m ? m[1] + '/' + m[2] + '/' + m[3] : '—',
          sortKey: m ? parseInt(m[3] + m[2] + m[1]) : 0,
          id: m ? m[4] : name,
          size: stat.size,
          url: '/boletos/' + folder + '/' + name,
          pagador, valor,
        };
      })
      .sort((a, b) => b.sortKey - a.sortKey);
    res.json(files);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/boletos/recent', auth, (req, res) => {
  try {
    if (!fs.existsSync(BOLETOS_DIR)) return res.json([]);
    let all = [];
    const folders = fs.readdirSync(BOLETOS_DIR)
      .filter(n => /^\d{2}-\d{4}$/.test(n))
      .sort((a, b) => {
        const [am, ay] = a.split('-').map(Number);
        const [bm, by] = b.split('-').map(Number);
        return (by * 12 + bm) - (ay * 12 + am);
      });

    for (const folder of folders) {
      const entries = loadSitemap(folder);
      // Assume que os novos estão no fim do array se usarmos push()
      all = all.concat([...entries].reverse());
      if (all.length >= 15) break;
    }
    res.json(all.slice(0, 15));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/boletos/search', auth, (req, res) => {
  try {
    const q = (req.query.q || '').trim().toLowerCase();
    if (!q || !fs.existsSync(BOLETOS_DIR)) return res.json([]);
    let searchTerm = q;
    try { const p = new URL(q); searchTerm = (p.searchParams.get('id') || q).toLowerCase(); } catch (_) { }
    const results = [];
    fs.readdirSync(BOLETOS_DIR).filter(n => /^\d{2}-\d{4}$/.test(n)).forEach(folder => {
      loadSitemap(folder).forEach(e => {
        const haystack = [e.hash, e.npedido, e.pagador, e.datavenc, e.dataemissao]
          .filter(Boolean).join(' ').toLowerCase();
        if (haystack.includes(searchTerm)) results.push(e);
      });
    });
    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
