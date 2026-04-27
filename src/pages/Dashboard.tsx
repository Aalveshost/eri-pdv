import { useState, useEffect, useRef, useCallback } from "react";
import {
  TrendingUp, Package, AlertTriangle,
  ChevronRight, DollarSign, Trophy, X, Search, Clock
} from "lucide-react";
import { createPortal } from "react-dom";
import { useDatabase } from "../hooks/useDatabase";
import { formatCurrency } from "../utils/currency";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

interface ProducaoItem {
  id: number;
  nome: string;
  qtd: number;
  data: string;
  hora: string;
}

interface MaisVendido {
  produto_nome: string;
  total_quantidade: number;
  total_valor: number;
}

// ─── Date helpers ────────────────────────────────────────────────────────────
function getFirstDayOfMonth() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-01`;
}
function getTodayIso() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}
function isoToBr(iso: string) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function brToIso(br: string) {
  const parts = br.replace(/_/g, "").split("/");
  const [d, m, y] = parts;
  if (!d || !m || !y || y.length < 4) return "";
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}
function isValidBr(br: string) {
  const clean = br.replace(/_/g, "");
  const [d, m, y] = clean.split("/").map(Number);
  return !!d && !!m && !!y && y > 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
}
function getTodayDigits() {
  const n = new Date();
  return String(n.getDate()).padStart(2, "0") + String(n.getMonth() + 1).padStart(2, "0") + String(n.getFullYear());
}
function isoToTime(iso: string) {
  if (!iso || !iso.includes(" ")) return "--:--";
  return iso.split(" ")[1].slice(0, 5);
}

// ─── Auto-format DateInput ────────────────────────────────────
function DateInput({
  value, 
  onChange,
  highlighted,
  externalRef,
  onKeyDown: externalKeyDown,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  highlighted?: boolean;
  externalRef?: React.RefObject<HTMLInputElement | null>;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  disabled?: boolean;
}) {
  const localRef = useRef<HTMLInputElement>(null);
  const inputRef = externalRef ?? localRef;
  const displayValue = value || '__/__/____';

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.setSelectionRange(0, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const isDigit = /^\d$/.test(e.key);
    
    if (e.key === "Escape" || e.key === "Tab" || e.key === "Enter" || e.key === "ArrowUp" || e.key === "ArrowDown") { 
      externalKeyDown?.(e); 
      return; 
    }

    const displayPos = input.selectionStart || 0;
    const rawPos = displayPos <= 2 ? displayPos : displayPos <= 5 ? displayPos - 1 : displayPos - 2;
    const prevRaw = (displayValue.replace(/\//g, '') + '________').slice(0, 8);
    const formatDate = (v: string) => `${v.slice(0,2)}/${v.slice(2,4)}/${v.slice(4,8)}`;

    if (isDigit && rawPos < 8) {
      e.preventDefault();
      const d = prevRaw.split('');
      d[rawPos] = e.key;
      const nd = d.join('');
      const newDisp = formatDate(nd);
      onChange(newDisp);

      const nextRaw = rawPos + 1;
      const nextDisp = nextRaw <= 2 ? nextRaw : nextRaw <= 4 ? nextRaw + 1 : nextRaw + 2;
      setTimeout(() => input.setSelectionRange(nextDisp, nextDisp), 0);
      return;
    }

    if (e.key === "Backspace") {
      e.preventDefault();
      const d = prevRaw.split('');
      const posToDel = (displayPos > 0 && input.selectionStart === input.selectionEnd) ? rawPos - 1 : rawPos;
      if (posToDel < 0) return;
      
      d[posToDel] = '_';
      const nd = d.join('');
      const newDisp = formatDate(nd);
      onChange(newDisp);

      const nextDisp = posToDel <= 2 ? posToDel : posToDel <= 4 ? posToDel + 1 : posToDel + 2;
      setTimeout(() => input.setSelectionRange(nextDisp, nextDisp), 0);
      return;
    }

    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') {
      e.preventDefault();
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={displayValue}
      onChange={() => {}}
      onFocus={handleFocus}
      onKeyDown={handleKeyDown}
      maxLength={10}
      disabled={disabled}
      className={cn(
        "luxury-input h-9 text-xs w-[130px] text-center font-mono tracking-widest outline-none transition-all",
        highlighted ? "border-luxury-orange ring-1 ring-luxury-orange/50 bg-luxury-orange/5" : "opacity-80"
      )}
    />
  );
}

// ─── Overlay ─────────────────────────────────────────────────────────────────
function Overlay({ onClose, zIndex = 300, children }: { onClose: () => void; zIndex?: number; children: React.ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm" style={{ zIndex }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>{children}</div>,
    document.body
  );
}

// ─── Popup "Ver Completo" (Vendas) ──────────────────────────────────
function PopupTodosVendidos({ db, defaultInicio, defaultFim, onClose }: any) {
  const [ini, setIni] = useState(defaultInicio); const [fim, setFim] = useState(defaultFim); const [lista, setLista] = useState<MaisVendido[]>([]); const [loading, setLoading] = useState(false);
  const iniRef = useRef<HTMLInputElement>(null); const fimRef = useRef<HTMLInputElement>(null); const buscarRef = useRef<HTMLButtonElement>(null);
  const buscar = useCallback(async (i: string, f: string) => {
    if (!db) return; const isoIni = brToIso(i); const isoFim = brToIso(f); if (!isoIni || !isoFim) return; setLoading(true);
    const query = `SELECT produto_nome, SUM(total_quantidade) as total_quantidade, SUM(total_valor) as total_valor FROM (SELECT p.nome as produto_nome, SUM(vi.quantidade) as total_quantidade, SUM(vi.quantidade * vi.preco_unitario) as total_valor FROM venda_itens vi JOIN vendas v ON v.id = vi.venda_id JOIN produtos p ON p.id = vi.produto_id WHERE date(v.data_venda) >= $1 AND date(v.data_venda) <= $2 AND v.status = 'completa' GROUP BY p.nome UNION ALL SELECT vi.produto_nome, SUM(vi.quantidade) as total_quantidade, SUM(vi.valor_total) as total_valor FROM vendas_prazo_itens vi JOIN vendas_prazo vp ON vp.id = vi.venda_id WHERE date(vp.data_venda) >= $1 AND date(vp.data_venda) <= $2 GROUP BY vi.produto_nome) GROUP BY produto_nome ORDER BY total_quantidade DESC`;
    try { const res: MaisVendido[] = await db.select(query, [isoIni, isoFim]); setLista(res); } catch (err) { console.error(err); } setLoading(false);
  }, [db]);
  useEffect(() => { buscar(ini, fim); }, [buscar]);
  useEffect(() => { setTimeout(() => { iniRef.current?.focus(); iniRef.current?.setSelectionRange(0, 0); }, 60); }, []);
  return (
    <Overlay onClose={onClose}>
      <div className="glass-card w-full max-w-xl flex flex-col gap-4 p-6" style={{ maxHeight: "85vh" }}>
        <div className="flex justify-between items-center shrink-0"><h3 className="text-lg font-black italic uppercase tracking-tight flex items-center gap-2"><Trophy className="text-luxury-orange" size={18} /> Ranking Completo</h3><button onClick={onClose} className="text-white/40 hover:text-white transition-colors"><X size={20} /></button></div>
        <div className="flex items-center gap-2 shrink-0 bg-white/5 rounded-xl px-4 py-3 border border-white/10"><Search size={14} className="text-white/30 shrink-0" /><DateInput externalRef={iniRef} value={ini} onChange={v => setIni(v)} /><span className="text-xs text-white/40 font-bold uppercase tracking-widest">Até</span><DateInput externalRef={fimRef} value={fim} onChange={v => setFim(v)} /><button ref={buscarRef} onClick={() => buscar(ini, fim)} className="ml-auto btn-primary h-8 px-4 text-xs">Buscar</button></div>
        <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-2 shrink-0"><span className="text-[10px] font-bold uppercase tracking-widest text-white/30">Produto</span><span className="text-[10px] font-bold uppercase tracking-widest text-white/30 text-right w-14">Qtd</span><span className="text-[10px] font-bold uppercase tracking-widest text-white/30 text-right w-24">Total</span></div>
        <div className="flex-1 overflow-y-auto space-y-1 pr-1">{loading && <div className="glass-card p-8 text-center"><p className="text-white/20 italic tracking-widest uppercase text-xs">Carregando...</p></div>}
          {!loading && lista.map((item, i) => (
            <div key={item.produto_nome} className="px-2 py-2 grid grid-cols-[1fr_auto_auto] gap-2 items-center border-b border-white/5">
              <div className="flex items-center gap-2 min-w-0"><span className={cn("text-[10px] font-black w-5 text-center shrink-0", i === 0 ? "text-yellow-400" : i === 1 ? "text-white/40" : i === 2 ? "text-orange-700" : "text-white/20")}>{i + 1}</span><span className="text-sm font-bold truncate">{item.produto_nome}</span></div>
              <span className="text-sm font-mono text-white/60 text-right w-14">{item.total_quantidade}x</span><span className="text-sm font-mono text-luxury-orange text-right w-24">R$ {formatCurrency(item.total_valor)}</span>
            </div>
          ))}
        </div>
      </div>
    </Overlay>
  );
}

// ─── Popup "Ver Completo" (Produção) ──────────────────────────────────
function PopupTodosProduzidos({ db, defaultInicio, defaultFim, onClose }: any) {
  const [ini, setIni] = useState(defaultInicio); const [fim, setFim] = useState(defaultFim); const [lista, setLista] = useState<ProducaoItem[]>([]); const [loading, setLoading] = useState(false);
  const iniRef = useRef<HTMLInputElement>(null); const fimRef = useRef<HTMLInputElement>(null); const buscarRef = useRef<HTMLButtonElement>(null);
  const buscar = useCallback(async (i: string, f: string) => {
    if (!db) return; const isoIni = brToIso(i); const isoFim = brToIso(f); if (!isoIni || !isoFim) return; setLoading(true);
    const query = `SELECT l.id, COALESCE(p.nome, l.produto_avulso_nome) as nome, l.qtd_inicial as qtd, l.data_fabricacao as data FROM lotes l LEFT JOIN produtos p ON l.produto_id = p.id WHERE date(l.data_fabricacao) >= $1 AND date(l.data_fabricacao) <= $2 ORDER BY l.data_fabricacao DESC`;
    try { const res: any[] = await db.select(query, [isoIni, isoFim]); setLista(res.map(p => ({ id: p.id, nome: p.nome, qtd: p.qtd, data: isoToBr(p.data), hora: isoToTime(p.data) }))); } catch (err) { console.error(err); } setLoading(false);
  }, [db]);
  useEffect(() => { buscar(ini, fim); }, [buscar]);
  useEffect(() => { setTimeout(() => { iniRef.current?.focus(); iniRef.current?.setSelectionRange(0, 0); }, 60); }, []);
  return (
    <Overlay onClose={onClose}>
      <div className="glass-card w-full max-w-xl flex flex-col gap-4 p-6" style={{ maxHeight: "85vh" }}>
        <div className="flex justify-between items-center shrink-0"><h3 className="text-lg font-black italic uppercase tracking-tight flex items-center gap-2"><Package className="text-luxury-orange" size={18} /> Histórico de Produção</h3><button onClick={onClose} className="text-white/40 hover:text-white transition-colors"><X size={20} /></button></div>
        <div className="flex items-center gap-2 shrink-0 bg-white/5 rounded-xl px-4 py-3 border border-white/10"><Search size={14} className="text-white/30 shrink-0" /><DateInput externalRef={iniRef} value={ini} onChange={v => setIni(v)} /><span className="text-xs text-white/40 font-bold uppercase tracking-widest">Até</span><DateInput externalRef={fimRef} value={fim} onChange={v => setFim(v)} /><button ref={buscarRef} onClick={() => buscar(ini, fim)} className="ml-auto btn-primary h-8 px-4 text-xs">Buscar</button></div>
        <div className="grid grid-cols-[auto_1fr_auto_auto] gap-2 px-2 shrink-0"><span className="w-5"></span><span className="text-[10px] font-bold uppercase tracking-widest text-white/30">Produto</span><span className="text-[10px] font-bold uppercase tracking-widest text-white/30 text-right w-14">Qtd</span><span className="text-[10px] font-bold uppercase tracking-widest text-white/30 text-right w-24">Data/Hora</span></div>
        <div className="flex-1 overflow-y-auto space-y-1 pr-1">{loading && <div className="glass-card p-8 text-center"><p className="text-white/20 italic tracking-widest uppercase text-xs">Carregando...</p></div>}
          {!loading && lista.map((item, i) => (
            <div key={item.id} className="px-2 py-2 grid grid-cols-[auto_1fr_auto_auto] gap-2 items-center border-b border-white/5">
              <span className="text-[10px] font-black w-5 text-center shrink-0 text-white/20">{i + 1}</span>
              <span className="text-sm font-bold truncate uppercase">{item.nome}</span>
              <span className="text-sm font-mono text-white/60 text-right w-14">{item.qtd}x</span>
              <div className="text-right w-24 shrink-0"><p className="text-[10px] text-white/40 font-bold">{item.data}</p><p className="text-xs font-mono text-luxury-orange">{item.hora}</p></div>
            </div>
          ))}
        </div>
      </div>
    </Overlay>
  );
}

// ════════════════════════════════════════════════════════════════════════════
export default function Dashboard() {
  const { db } = useDatabase();
  const [stats, setStats] = useState({ vendasHoje: 0, lucroHoje: 0, totalEstoque: 0, itensVencendo: 0 });
  const [producaoLista, setProducaoLista] = useState<ProducaoItem[]>([]);
  const [prodIni, setProdIni] = useState(isoToBr(getTodayIso())); const [prodFim, setProdFim] = useState(isoToBr(getTodayIso()));
  const [showPopupProd, setShowPopupProd] = useState(false);
  const [mvInicio, setMvInicio] = useState(isoToBr(getFirstDayOfMonth())); const [mvFim, setMvFim] = useState(isoToBr(getTodayIso())); const [maisVendidos, setMaisVendidos] = useState<MaisVendido[]>([]); const [showPopupVendidos, setShowPopupVendidos] = useState(false);

  type NavZone = null | "prod-ini" | "prod-fim" | "ver-prod" | "prod-lista" | "mv-inicio" | "mv-fim" | "ver-completo" | "mv-lista";
  const [navZone, setNavZone] = useState<NavZone>(null); const [focusedProdIdx, setFocusedProdIdx] = useState<number | null>(null); const [focusedMvIdx, setFocusedMvIdx] = useState<number | null>(null); const [inputActive, setInputActive] = useState(false);

  const prodIniRef = useRef<HTMLInputElement>(null); const prodFimRef = useRef<HTMLInputElement>(null); const verProdBtnRef = useRef<HTMLButtonElement>(null); const prodRefs = useRef<(HTMLDivElement | null)[]>([]);
  const mvInicioRef = useRef<HTMLInputElement>(null); const mvFimRef = useRef<HTMLInputElement>(null); const verCompletoBtnRef = useRef<HTMLButtonElement>(null); const mvRefs = useRef<(HTMLDivElement | null)[]>([]);

  const loadDashboard = async () => {
    if (!db) return;
    try {
      const vendas: any[] = await db.select(`SELECT SUM(total_venda) as total, SUM(total_venda - (SELECT SUM(quantidade * preco_custo) FROM venda_itens vi WHERE vi.venda_id = v.id)) as lucro FROM vendas v WHERE date(data_venda) = date('now')`);
      const estoque: any[] = await db.select("SELECT SUM(qtd_atual) as total FROM lotes WHERE status = 'ativo'");
      const config: any[] = await db.select("SELECT dias_alerta_validade FROM configuracoes WHERE id = 1");
      const dias = config[0]?.dias_alerta_validade || 5;
      const vencendo: any[] = await db.select(`SELECT count(*) as total FROM lotes WHERE status = 'ativo' AND (julianday(data_validade) - julianday('now')) <= ${dias}`);
      setStats({ vendasHoje: vendas[0]?.total || 0, lucroHoje: vendas[0]?.lucro || 0, totalEstoque: estoque[0]?.total || 0, itensVencendo: vencendo[0]?.total || 0 });
    } catch (err) { console.error(err); }
  };

  const loadProducao = useCallback(async () => {
    if (!db) return; const isoIni = brToIso(prodIni); const isoFim = brToIso(prodFim); if (!isoIni || !isoFim) return;
    try { const res: any[] = await db.select(`SELECT l.id, COALESCE(p.nome, l.produto_avulso_nome) as nome, l.qtd_inicial as qtd, l.data_fabricacao as data FROM lotes l LEFT JOIN produtos p ON l.produto_id = p.id WHERE date(l.data_fabricacao) >= $1 AND date(l.data_fabricacao) <= $2 ORDER BY l.data_fabricacao DESC LIMIT 10`, [isoIni, isoFim]); setProducaoLista(res.map(p => ({ id: p.id, nome: p.nome, qtd: p.qtd, data: isoToBr(p.data), hora: isoToTime(p.data) }))); } catch (err) { console.error(err); }
  }, [db, prodIni, prodFim]);

  const loadMaisVendidos = useCallback(async () => {
    if (!db) return; const isoIni = brToIso(mvInicio); const isoFim = brToIso(mvFim); if (!isoIni || !isoFim) return;
    try { const all: MaisVendido[] = await db.select(`SELECT produto_nome, SUM(total_quantidade) as total_quantidade, SUM(total_valor) as total_valor FROM (SELECT p.nome as produto_nome, SUM(vi.quantidade) as total_quantidade, SUM(vi.quantidade * vi.preco_unitario) as total_valor FROM venda_itens vi JOIN vendas v ON v.id = vi.venda_id JOIN produtos p ON p.id = vi.produto_id WHERE date(v.data_venda) >= $1 AND date(v.data_venda) <= $2 AND v.status = 'completa' GROUP BY p.nome UNION ALL SELECT vi.produto_nome, SUM(vi.quantidade) as total_quantidade, SUM(vi.valor_total) as total_valor FROM vendas_prazo_itens vi JOIN vendas_prazo vp ON vp.id = vi.venda_id WHERE date(vp.data_venda) >= $1 AND date(vp.data_venda) <= $2 GROUP BY vi.produto_nome) GROUP BY produto_nome ORDER BY total_quantidade DESC LIMIT 10`, [isoIni, isoFim]); setMaisVendidos(all); } catch (err) { console.error(err); }
  }, [db, mvInicio, mvFim]);

  useEffect(() => { loadDashboard(); }, [db]);
  useEffect(() => { loadProducao(); }, [loadProducao]);
  useEffect(() => { loadMaisVendidos(); }, [loadMaisVendidos]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (showPopupVendidos || showPopupProd) return;
      if (inputActive) { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); setInputActive(false); prodIniRef.current?.blur(); prodFimRef.current?.blur(); mvInicioRef.current?.blur(); mvFimRef.current?.blur(); } return; }
      if (e.key === "Escape") { setNavZone(null); setFocusedProdIdx(null); setFocusedMvIdx(null); return; }
      if (e.key === "Enter" && navZone === null) { e.preventDefault(); setNavZone("prod-ini"); return; }
      
      if (navZone === "prod-ini") {
        if (e.key === "Enter") { e.preventDefault(); setInputActive(true); setTimeout(() => { prodIniRef.current?.focus(); prodIniRef.current?.setSelectionRange(0, 0); }, 0); }
        else if (e.key === "ArrowRight") { e.preventDefault(); setNavZone("prod-fim"); }
        else if (e.key === "ArrowDown") { e.preventDefault(); if (producaoLista.length > 0) { setNavZone("prod-lista"); setFocusedProdIdx(0); setTimeout(() => prodRefs.current[0]?.focus(), 0); } }
      } else if (navZone === "prod-fim") {
        if (e.key === "Enter") { e.preventDefault(); setInputActive(true); setTimeout(() => { prodFimRef.current?.focus(); prodFimRef.current?.setSelectionRange(0, 0); }, 0); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); setNavZone("prod-ini"); }
        else if (e.key === "ArrowRight") { e.preventDefault(); setNavZone("ver-prod"); setTimeout(() => verProdBtnRef.current?.focus(), 0); }
        else if (e.key === "ArrowDown") { e.preventDefault(); if (producaoLista.length > 0) { setNavZone("prod-lista"); setFocusedProdIdx(0); setTimeout(() => prodRefs.current[0]?.focus(), 0); } }
      } else if (navZone === "ver-prod") {
        if (e.key === "ArrowLeft") { e.preventDefault(); setNavZone("prod-fim"); }
        else if (e.key === "ArrowRight") { e.preventDefault(); setNavZone("mv-inicio"); }
        else if (e.key === "ArrowDown") { e.preventDefault(); if (producaoLista.length > 0) { setNavZone("prod-lista"); setFocusedProdIdx(0); setTimeout(() => prodRefs.current[0]?.focus(), 0); } }
        else if (e.key === "Enter") { e.preventDefault(); setShowPopupProd(true); }
      } else if (navZone === "prod-lista" && focusedProdIdx !== null) {
        if (e.key === "ArrowDown") { e.preventDefault(); if (focusedProdIdx < producaoLista.length - 1) { const n = focusedProdIdx + 1; setFocusedProdIdx(n); setTimeout(() => prodRefs.current[n]?.focus(), 0); } }
        else if (e.key === "ArrowUp") { e.preventDefault(); if (focusedProdIdx > 0) { const p = focusedProdIdx - 1; setFocusedProdIdx(p); setTimeout(() => prodRefs.current[p]?.focus(), 0); } else { setNavZone("prod-ini"); setFocusedProdIdx(null); } }
        else if (e.key === "ArrowRight") { e.preventDefault(); setNavZone("mv-lista"); setFocusedMvIdx(0); setTimeout(() => mvRefs.current[0]?.focus(), 0); }
      } else if (navZone === "mv-inicio") {
        if (e.key === "Enter") { e.preventDefault(); setInputActive(true); setTimeout(() => { mvInicioRef.current?.focus(); mvInicioRef.current?.setSelectionRange(0, 0); }, 0); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); setNavZone("ver-prod"); setTimeout(() => verProdBtnRef.current?.focus(), 0); }
        else if (e.key === "ArrowRight") { e.preventDefault(); setNavZone("mv-fim"); }
        else if (e.key === "ArrowDown") { e.preventDefault(); if (maisVendidos.length > 0) { setNavZone("mv-lista"); setFocusedMvIdx(0); setTimeout(() => mvRefs.current[0]?.focus(), 0); } }
      } else if (navZone === "mv-fim") {
        if (e.key === "Enter") { e.preventDefault(); setInputActive(true); setTimeout(() => { mvFimRef.current?.focus(); mvFimRef.current?.setSelectionRange(0, 0); }, 0); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); setNavZone("mv-inicio"); }
        else if (e.key === "ArrowRight") { e.preventDefault(); setNavZone("ver-completo"); setTimeout(() => verCompletoBtnRef.current?.focus(), 0); }
        else if (e.key === "ArrowDown") { e.preventDefault(); if (maisVendidos.length > 0) { setNavZone("mv-lista"); setFocusedMvIdx(0); setTimeout(() => mvRefs.current[0]?.focus(), 0); } }
      } else if (navZone === "ver-completo") {
        if (e.key === "Enter") { e.preventDefault(); setShowPopupVendidos(true); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); setNavZone("mv-fim"); }
        else if (e.key === "ArrowDown") { e.preventDefault(); if (maisVendidos.length > 0) { setNavZone("mv-lista"); setFocusedMvIdx(0); setTimeout(() => mvRefs.current[0]?.focus(), 0); } }
      } else if (navZone === "mv-lista" && focusedMvIdx !== null) {
        if (e.key === "ArrowDown") { e.preventDefault(); if (focusedMvIdx < maisVendidos.length - 1) { const n = focusedMvIdx + 1; setFocusedMvIdx(n); setTimeout(() => mvRefs.current[n]?.focus(), 0); } }
        else if (e.key === "ArrowUp") { e.preventDefault(); if (focusedMvIdx > 0) { const p = focusedMvIdx - 1; setFocusedMvIdx(p); setTimeout(() => mvRefs.current[p]?.focus(), 0); } else { setNavZone("mv-inicio"); setFocusedMvIdx(null); } }
        else if (e.key === "ArrowLeft") { e.preventDefault(); setNavZone("prod-lista"); setFocusedProdIdx(0); setTimeout(() => prodRefs.current[0]?.focus(), 0); }
      }
    };
    window.addEventListener("keydown", handler, true); return () => window.removeEventListener("keydown", handler, true);
  }, [navZone, focusedProdIdx, focusedMvIdx, inputActive, producaoLista, maisVendidos, showPopupProd, showPopupVendidos]);

  return (
    <div className="h-full flex flex-col gap-5 overflow-hidden">
      <header><h2 className="text-3xl font-black italic uppercase tracking-tighter text-white">Dashboard <span className="text-luxury-orange">Geral</span></h2></header>
      <div className="grid grid-cols-4 gap-4 shrink-0">
        <StatCard title="Vendas Hoje" value={`R$ ${formatCurrency(stats.vendasHoje)}`} icon={TrendingUp} color="orange" />
        <StatCard title="Lucro Líquido" value={`R$ ${formatCurrency(stats.lucroHoje)}`} icon={DollarSign} color="green" />
        <StatCard title="Estoque Total" value={`${stats.totalEstoque} un`} icon={Package} color="blue" />
        <StatCard title="Alertas Críticos" value={stats.itensVencendo.toString()} icon={AlertTriangle} color="red" highlight={stats.itensVencendo > 0} />
      </div>
      <div className="flex-1 grid grid-cols-2 gap-8 overflow-hidden min-h-0">
        <div className="flex flex-col gap-3 overflow-hidden">
          <div className="flex justify-between items-center shrink-0"><h3 className="text-base font-black italic uppercase tracking-tight flex items-center gap-2"><Package className="text-luxury-orange" size={18} /> Produção</h3></div>
          <div className="flex items-center gap-1.5 shrink-0 pr-1">
            <span className="text-[10px] text-white/40 font-bold uppercase tracking-widest shrink-0">De</span>
            <div className={cn("rounded-lg transition-all", navZone === "prod-ini" && !inputActive ? "ring-1 ring-luxury-orange/60 bg-luxury-orange/5" : "")}><DateInput externalRef={prodIniRef} value={prodIni} onChange={v => setProdIni(v)} highlighted={navZone === "prod-ini" && inputActive} /></div>
            <span className="text-[10px] text-white/40 font-bold uppercase tracking-widest shrink-0">Até</span>
            <div className={cn("rounded-lg transition-all", navZone === "prod-fim" && !inputActive ? "ring-1 ring-luxury-orange/60 bg-luxury-orange/5" : "")}><DateInput externalRef={prodFimRef} value={prodFim} onChange={v => setProdFim(v)} highlighted={navZone === "prod-fim" && inputActive} /></div>
            <button ref={verProdBtnRef} tabIndex={-1} onClick={() => setShowPopupProd(true)} onFocus={() => setNavZone("ver-prod")} className={cn("ml-auto text-[10px] font-bold uppercase tracking-widest flex items-center gap-0.5 transition-all outline-none rounded-md whitespace-nowrap shrink-0", navZone === "ver-prod" ? "text-luxury-orange ring-1 ring-luxury-orange/50 px-1.5 py-1 bg-luxury-orange/5" : "text-white/40 hover:text-luxury-orange")}>Ver completo <ChevronRight size={10} /></button>
          </div>
          <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 shrink-0"><span className="text-[10px] font-bold uppercase tracking-widest text-white/30">Produto</span><span className="text-[10px] font-bold uppercase tracking-widest text-white/30 text-right w-14">Qtd</span><span className="text-[10px] font-bold uppercase tracking-widest text-white/30 text-right w-20">Hora</span></div>
          <div className="flex-1 overflow-y-auto space-y-1 pr-1">{producaoLista.length === 0 ? (<div className="glass-card p-8 text-center border-dashed border-white/10"><p className="text-white/20 italic tracking-widest uppercase text-xs">Sem produção no período</p></div>) : (producaoLista.map((item, i) => (<div key={item.id} ref={el => { prodRefs.current[i] = el; }} tabIndex={-1} onFocus={() => { setNavZone("prod-lista"); setFocusedProdIdx(i); }} className={cn("glass-card px-3 py-2.5 grid grid-cols-[1fr_auto_auto] gap-2 items-center outline-none transition-all cursor-default", navZone === "prod-lista" && focusedProdIdx === i ? "border-luxury-orange/50 bg-luxury-orange/5 ring-1 ring-luxury-orange/30" : "")}><div className="flex items-center gap-2 min-w-0"><span className="text-[10px] font-black w-5 text-center shrink-0 text-white/20">{i + 1}</span><span className="text-sm font-bold truncate uppercase">{item.nome}</span></div><span className="text-sm font-mono text-white/60 text-right w-14">{item.qtd}x</span><div className="flex items-center justify-end gap-1 text-luxury-orange w-20"><Clock size={12} /><span className="text-sm font-mono text-right">{item.hora}</span></div></div>)))}</div>
        </div>
        <div className="flex flex-col gap-3 overflow-hidden">
          <div className="flex justify-between items-center shrink-0"><h3 className="text-base font-black italic uppercase tracking-tight flex items-center gap-2"><Trophy className="text-luxury-orange" size={18} /> Mais Vendidos</h3></div>
          <div className="flex items-center gap-1.5 shrink-0 pr-1">
            <span className="text-[10px] text-white/40 font-bold uppercase tracking-widest shrink-0">De</span>
            <div className={cn("rounded-lg transition-all", navZone === "mv-inicio" && !inputActive ? "ring-1 ring-luxury-orange/60 bg-luxury-orange/5" : "")}><DateInput externalRef={mvInicioRef} value={mvInicio} onChange={v => setMvInicio(v)} highlighted={navZone === "mv-inicio" && inputActive} /></div>
            <span className="text-[10px] text-white/40 font-bold uppercase tracking-widest shrink-0">Até</span>
            <div className={cn("rounded-lg transition-all", navZone === "mv-fim" && !inputActive ? "ring-1 ring-luxury-orange/60 bg-luxury-orange/5" : "")}><DateInput externalRef={mvFimRef} value={mvFim} onChange={v => setMvFim(v)} highlighted={navZone === "mv-fim" && inputActive} /></div>
            <button ref={verCompletoBtnRef} tabIndex={-1} onClick={() => setShowPopupVendidos(true)} onFocus={() => setNavZone("ver-completo")} className={cn("ml-auto text-[10px] font-bold uppercase tracking-widest flex items-center gap-0.5 transition-all outline-none rounded-md whitespace-nowrap shrink-0", navZone === "ver-completo" ? "text-luxury-orange ring-1 ring-luxury-orange/50 px-1.5 py-1 bg-luxury-orange/5" : "text-white/40 hover:text-luxury-orange")}>Ver completo <ChevronRight size={10} /></button>
          </div>
          <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 shrink-0"><span className="text-[10px] font-bold uppercase tracking-widest text-white/30">Produto</span><span className="text-[10px] font-bold uppercase tracking-widest text-white/30 text-right w-14">Qtd</span><span className="text-[10px] font-bold uppercase tracking-widest text-white/30 text-right w-20">Total</span></div>
          <div className="flex-1 overflow-y-auto space-y-1 pr-1">{maisVendidos.length === 0 ? (<div className="glass-card p-8 text-center border-dashed border-white/10"><p className="text-white/20 italic tracking-widest uppercase text-xs">Sem vendas no período</p></div>) : (maisVendidos.map((item, i) => (<div key={item.produto_nome} ref={el => { mvRefs.current[i] = el; }} tabIndex={-1} onFocus={() => { setNavZone("mv-lista"); setFocusedMvIdx(i); }} className={cn("glass-card px-3 py-2.5 grid grid-cols-[1fr_auto_auto] gap-2 items-center outline-none transition-all cursor-default", navZone === "mv-lista" && focusedMvIdx === i ? "border-luxury-orange/50 bg-luxury-orange/5 ring-1 ring-luxury-orange/30" : "")}><div className="flex items-center gap-2 min-w-0"><span className={cn("text-[10px] font-black w-5 text-center shrink-0", i === 0 ? "text-yellow-400" : i === 1 ? "text-white/40" : i === 2 ? "text-orange-700" : "text-white/20")}>{i + 1}</span><span className="text-sm font-bold truncate uppercase">{item.produto_nome}</span></div><span className="text-sm font-mono text-white/60 text-right w-14">{item.total_quantidade}x</span><span className="text-sm font-mono text-luxury-orange text-right w-20">R$ {formatCurrency(item.total_valor)}</span></div>)))}</div>
        </div>
      </div>
      {showPopupVendidos && <PopupTodosVendidos db={db} defaultInicio={mvInicio} defaultFim={mvFim} onClose={() => setShowPopupVendidos(false)} />}
      {showPopupProd && <PopupTodosProduzidos db={db} defaultInicio={prodIni} defaultFim={prodFim} onClose={() => setShowPopupProd(false)} />}
    </div>
  );
}

function StatCard({ title, value, icon: Icon, color, highlight = false }: any) {
  const colors: any = { orange: "text-luxury-orange bg-luxury-orange/10 border-luxury-orange/20", green: "text-green-500 bg-green-500/10 border-green-500/20", blue: "text-blue-500 bg-blue-500/10 border-blue-500/20", red: "text-red-500 bg-red-500/10 border-red-500/20" };
  return (
    <div className={cn("glass-card p-5 border-b-4 transition-all hover:translate-y-[-2px]", highlight ? "ring-2 ring-red-500/50" : "", color === "orange" ? "border-b-luxury-orange" : color === "green" ? "border-b-green-500" : color === "blue" ? "border-b-blue-500" : "border-b-red-500")}>
      <div className="flex flex-col gap-3"><div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", colors[color])}><Icon size={20} /></div><div><p className="text-white/40 text-[10px] uppercase font-black tracking-[0.2em] mb-1">{title}</p><p className="text-2xl font-black italic tracking-tighter">{value}</p></div></div>
    </div>
  );
}
