import { useState, useEffect, useRef } from "react";
import { Save, Database, Folder, RefreshCw, Upload, Lock, Eye, EyeOff, Check } from "lucide-react";
import { useDatabase } from "../hooks/useDatabase";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { cn } from "../utils/cn";
import {
  DEFAULT_ACCESS_PASSWORD,
  isValidAccessPassword,
  normalizeStoredAccessPassword,
  sanitizeAccessPassword,
} from "../utils/accessPassword";

let configShouldFocusOnMount = false;
export const setConfigShouldFocusOnMount = (val: boolean) => { configShouldFocusOnMount = val; };

export default function Configuracoes() {
  const { db } = useDatabase();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    dias_alerta_validade: 5,
    caminho_backup_externo: "",
    nome_loja: "Salgados Pro",
    frequencia_backup_dias: 7,
    senha: DEFAULT_ACCESS_PASSWORD
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const fNomeRef = useRef<HTMLInputElement>(null);
  const fSenhaRef = useRef<HTMLInputElement>(null);
  const fCaminhoRef = useRef<HTMLInputElement>(null);
  const fFreqRef = useRef<HTMLSelectElement>(null);
  const fBackupBtnRef = useRef<HTMLButtonElement>(null);
  const fImportBtnRef = useRef<HTMLButtonElement>(null);
  const fSalvarBtnRef = useRef<HTMLButtonElement>(null);

  const navMap: Record<string, any> = {
    nome: { down: fSenhaRef, right: fCaminhoRef },
    senha: { up: fNomeRef, right: fFreqRef, down: fBackupBtnRef },
    caminho: { left: fNomeRef, down: fFreqRef },
    freq: { up: fCaminhoRef, left: fSenhaRef, down: fBackupBtnRef, right: fBackupBtnRef },
    backup: { up: fFreqRef, left: fSenhaRef, down: fImportBtnRef },
    import: { up: fBackupBtnRef, left: fSenhaRef, down: fSalvarBtnRef },
    salvar: { up: fImportBtnRef, left: fImportBtnRef }
  };

  const handleNav = (e: React.KeyboardEvent, field: string) => {
    const isEnter = e.key === 'Enter';
    const isTab = e.key === 'Tab';
    const isArrow = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape'].includes(e.key);

    if (!isEnter && !isTab && !isArrow) return;

    // Special Case: Password field logic
    if (field === 'senha') {
      if (isEnter) {
        e.preventDefault();
        e.stopPropagation();
        setShowPassword(prev => !prev);
        setTimeout(() => {
          if (fSenhaRef.current) {
            fSenhaRef.current.focus();
            const val = fSenhaRef.current.value;
            fSenhaRef.current.setSelectionRange(val.length, val.length);
          }
        }, 0);
        return;
      }
      // Block ArrowLeft to prevent cursor movement
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        return;
      }
      // Force ArrowRight to go to Freq regardless of cursor position
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        fFreqRef.current?.focus();
        return;
      }
    }

    const nav = navMap[field];
    if (!nav) return;

    let target = null;
    if (e.key === 'ArrowUp' || (isTab && e.shiftKey)) target = nav.up;
    else if (e.key === 'ArrowDown' || (isTab && !e.shiftKey)) target = nav.down;
    else if (e.key === 'ArrowLeft') target = nav.left;
    else if (e.key === 'ArrowRight') target = nav.right;
    // Enter on other fields moves down
    else if (isEnter) target = nav.down;

    if (target?.current) {
      e.preventDefault();
      e.stopPropagation();
      target.current.focus();
      if (target.current instanceof HTMLInputElement && target.current.type !== 'password') {
         const val = target.current.value;
         target.current.setSelectionRange(val.length, val.length);
      }
    }
  };

  const loadConfig = async () => {
    if (!db) return;
    try {
      const res: any[] = await db.select("SELECT * FROM configuracoes WHERE id = 1");
      if (res.length > 0) {
        setForm({
          dias_alerta_validade: res[0].dias_alerta_validade,
          caminho_backup_externo: res[0].caminho_backup_externo || "",
          nome_loja: res[0].nome_loja || "Salgados Pro",
          frequencia_backup_dias: res[0].frequencia_backup_dias || 7,
          senha: normalizeStoredAccessPassword(res[0].senha)
        });
      }
    } catch (err) {
      console.error("Erro ao carregar configurações:", err);
    }
  };

  useEffect(() => {
    loadConfig();
  }, [db]);

  useEffect(() => {
    // Focus and cursor at end for Nome Loja on mount ONLY if explicit Enter was used
    setTimeout(() => {
      if (configShouldFocusOnMount && fNomeRef.current) {
        fNomeRef.current.focus();
        const val = fNomeRef.current.value;
        fNomeRef.current.setSelectionRange(val.length, val.length);
        configShouldFocusOnMount = false; // Reset for next time
      }
    }, 100);

    const handleGlobalKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // ESC goes to sidebar
        e.preventDefault();
        e.stopImmediatePropagation();
        const sidebarLink = document.querySelector('aside nav a[class*="bg-luxury-orange"]') as HTMLElement;
        sidebarLink?.focus();
      }
    };

    window.addEventListener('keydown', handleGlobalKey, true);
    return () => window.removeEventListener('keydown', handleGlobalKey, true);
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db) return;

    if (!isValidAccessPassword(form.senha)) {
      alert("A senha deve ter exatamente 4 caracteres usando apenas letras de a a z e numeros de 0 a 9.");
      fSenhaRef.current?.focus();
      return;
    }

    setLoading(true);

    try {
      await db.execute(
        "UPDATE configuracoes SET dias_alerta_validade = $1, caminho_backup_externo = $2, nome_loja = $3, frequencia_backup_dias = $4, senha = $5 WHERE id = 1",
        [form.dias_alerta_validade, form.caminho_backup_externo, form.nome_loja, form.frequencia_backup_dias, form.senha]
      );
      
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 1500);
    } catch (err) {
      console.error("Erro ao salvar:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleManualBackup = async () => {
    try {
      setLoading(true);
      const result = await invoke("check_and_run_backup", {
        backupDir: form.caminho_backup_externo
      });
      alert("Backup realizado com sucesso!");
      console.log(result);
    } catch (err) {
      alert("Erro ao realizar backup: " + err);
    } finally {
      setLoading(false);
    }
  };

  const handlePickFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false, title: "Selecionar pasta de backup" });
      if (selected && typeof selected === 'string') {
        setForm(f => ({ ...f, caminho_backup_externo: selected }));
      }
    } catch (err) {
      console.error("Erro ao selecionar pasta:", err);
    }
  };

  const handleImportBackup = async () => {
    try {
      const selected = await open({
        filters: [{ name: 'Database', extensions: ['db'] }],
        title: "Selecionar arquivo de backup para importar"
      });
      if (selected && typeof selected === 'string') {
        setLoading(true);
        await invoke("import_backup", { backupPath: selected });
        alert("Backup importado com sucesso! Por favor, reinicie o aplicativo.");
      }
    } catch (err) {
      alert("Erro ao importar backup: " + err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8 h-full flex flex-col">
      <header>
        <h2 className="text-3xl font-black italic uppercase tracking-tighter text-white">Configurações do <span className="text-luxury-orange">Sistema</span></h2>
        <p className="text-white/40">Gerencie alertas, backups e dados da loja.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="glass-card p-8 space-y-8">
          <div className="flex items-center gap-3 border-b border-white/5 pb-4">
            <Lock className="text-luxury-orange" size={24} />
            <h3 className="text-xl font-bold uppercase italic tracking-tight">Segurança & Loja</h3>
          </div>

          <div className="space-y-6">
            <label className="block">
              <span className="text-xs uppercase tracking-widest text-white/40 font-bold mb-2 block">Nome da Loja / Unidade</span>
              <input 
                ref={fNomeRef}
                name="nome_loja"
                type="text" 
                className="luxury-input w-full h-12"
                value={form.nome_loja}
                onChange={e => setForm({...form, nome_loja: e.target.value})}
                onKeyDown={e => handleNav(e, 'nome')}
              />
            </label>

            <div className="pt-4 border-t border-white/5">
              <label className="block">
                <div className="flex justify-between items-end mb-2">
                  <span className="text-xs uppercase tracking-widest text-white/40 font-bold block">Senha de Acesso (Outras áreas)</span>
                </div>
                <div className="relative">
                  <input 
                    ref={fSenhaRef}
                    type={showPassword ? "text" : "password"} 
                    className="luxury-input w-full h-12 pr-12 font-mono text-xl tracking-[0.3em] transition-all opacity-80 focus:opacity-100 focus:border-luxury-orange focus:ring-1 focus:ring-luxury-orange/20"
                    value={form.senha}
                    maxLength={4}
                    onChange={e => setForm({...form, senha: sanitizeAccessPassword(e.target.value)})}
                    onBlur={() => setShowPassword(false)}
                    onKeyDown={e => handleNav(e, 'senha')}
                  />
                  <button 
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-white/20 hover:text-white transition-colors"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                <span className="text-[10px] text-white/20 mt-2 block italic">Use exatamente 4 caracteres com letras de a a z e numeros de 0 a 9.</span>
              </label>
            </div>
          </div>
        </div>

        <div className="glass-card p-8 space-y-8">
          <div className="flex items-center gap-3 border-b border-white/5 pb-4">
            <Database className="text-luxury-orange" size={24} />
            <h3 className="text-xl font-bold uppercase italic tracking-tight">Backup & Segurança</h3>
          </div>

          <div className="space-y-6">
            <label className="block">
              <span className="text-xs uppercase tracking-widest text-white/40 font-bold mb-2 block flex items-center gap-2">
                <Folder size={14} /> Caminho de Backup Externo (Pasta Cloud/Google Drive)
              </span>
              <div className="relative">
                <input 
                  ref={fCaminhoRef}
                  type="text" 
                  placeholder="Ex: C:/Users/Nome/Google Drive/Backups"
                  className="luxury-input w-full h-12 font-mono text-sm pr-12"
                  value={form.caminho_backup_externo}
                  onChange={e => setForm({...form, caminho_backup_externo: e.target.value})}
                  onKeyDown={e => handleNav(e, 'caminho')}
                />
                <button
                  type="button"
                  onClick={handlePickFolder}
                  title="Selecionar pasta"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-white/30 hover:text-luxury-orange transition-colors rounded-lg hover:bg-white/5"
                >
                  <Folder size={18} />
                </button>
              </div>
              <span className="text-[10px] text-white/20 mt-1 block italic">O sistema verificará mensalmente se o backup foi feito.</span>
            </label>

            <label className="block">
              <span className="text-xs uppercase tracking-widest text-white/40 font-bold mb-2 block">Frequência de Backup Automático</span>
              <select
                ref={fFreqRef}
                className="luxury-input w-full h-12"
                value={form.frequencia_backup_dias}
                onChange={e => setForm({...form, frequencia_backup_dias: parseInt(e.target.value)})}
                onKeyDown={e => handleNav(e, 'freq')}
              >
                <option value={1}>Diário</option>
                <option value={2}>A cada 2 dias</option>
                <option value={5}>A cada 5 dias</option>
                <option value={7}>Semanal (7 dias)</option>
                <option value={15}>A cada 15 dias</option>
              </select>
              {!form.caminho_backup_externo && (
                <span className="text-[10px] text-white/20 mt-1 block italic">Configure o diretório de backup para ativar a frequência.</span>
              )}
            </label>

            <div className="pt-4 border-t border-white/5 space-y-4">
              <button
                ref={fBackupBtnRef}
                onClick={handleManualBackup}
                disabled={loading || !form.caminho_backup_externo}
                onKeyDown={e => handleNav(e, 'backup')}
                className="w-full flex items-center justify-center gap-2 h-12 rounded-xl border border-white/10 hover:bg-white/5 focus:bg-white/5 focus:border-[#eeeeee] focus:ring-1 focus:ring-white/20 transition-all uppercase text-xs font-black tracking-widest disabled:opacity-50 disabled:cursor-not-allowed outline-none"
              >
                <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                Executar Backup Agora
              </button>

              <button
                ref={fImportBtnRef}
                onClick={handleImportBackup}
                disabled={loading}
                onKeyDown={e => handleNav(e, 'import')}
                className="w-full flex items-center justify-center gap-2 h-12 rounded-xl border border-white/10 hover:bg-white/5 focus:bg-white/5 focus:border-[#eeeeee] focus:ring-1 focus:ring-white/20 transition-all uppercase text-xs font-black tracking-widest outline-none"
              >
                <Upload size={16} />
                Importar Backup
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-auto flex justify-end">
        <button 
          ref={fSalvarBtnRef}
          onClick={handleSave}
          disabled={loading}
          onKeyDown={e => handleNav(e, 'salvar')}
          className="btn-primary flex items-center gap-2 px-10 h-14 focus:ring-2 focus:ring-white/50 focus:border-[#eeeeee] transition-all outline-none"
        >
          <Save size={20} />
          Salvar Alterações
        </button>
      </div>

      {/* Notificação de Sucesso */}
      {showSuccess && (
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[500] animate-in fade-in zoom-in duration-300">
          <div className="bg-green-500/20 backdrop-blur-md border border-green-500/30 text-green-400 px-6 py-3 rounded-full flex items-center gap-3 shadow-2xl shadow-green-500/10">
            <div className="bg-green-500 text-black rounded-full p-1">
              <Check size={14} strokeWidth={4} />
            </div>
            <span className="font-bold uppercase tracking-widest text-xs">Configurações Salvas!</span>
          </div>
        </div>
      )}
    </div>
  );
}
