import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { Users, FileText, BarChart2, Plus, Search, Edit2, Trash2, X, Archive, FolderOpen, Printer } from "lucide-react";
import { useDatabase } from "../hooks/useDatabase";
import { handleCurrencyInput, parseCurrencyToNumber } from "../utils/currency";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { FileDown } from "lucide-react";

type SubTela = 'clientes' | 'conta' | 'saldo' | 'arquivados';

interface Cliente {
  id: number;
  nome: string;
  telefone: string | null;
  observacao: string | null;
  criado_em: string;
}

interface VendaPrazoItem {
  id: number;
  venda_id: number;
  produto_nome: string;
  quantidade: number;
  valor_total: number;
}

interface Pagamento {
  id: number;
  cliente_id: number;
  data_pagamento: string;
  valor: number;
  observacao: string | null;
}

interface SaldoCliente {
  id: number;
  nome: string;
  telefone: string | null;
  total_compras: number;
  total_pago: number;
  saldo: number;
}

// ─── helper de moeda ────────────────────────────────────────────────
function fmtBRL(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── helpers de data ────────────────────────────────────────────────
function getTodayStr() {
  const now = new Date();
  return `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()}`;
}

function getFirstDayOfMonthStr() {
  const now = new Date();
  return `01/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()}`;
}

/** Converte DD/MM/YYYY → YYYY-MM-DD para comparação/armazenamento */
function brToIso(br: string): string {
  const [d, m, y] = br.split('/');
  if (!d || !m || !y) return '';
  return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
}

/** Converte YYYY-MM-DD → DD/MM/YYYY para exibição */
function isoToBr(iso: string): string {
  if (!iso) return '';
  // Limpa possíveis horas (T00:00:00) antes de dar split
  const cleanIso = iso.includes('T') ? iso.split('T')[0] : iso;
  const [y, m, d] = cleanIso.split('-');
  if (!y || !m || !d) return iso; // Fallback se o formato for estranho
  return `${d}/${m}/${y}`;
}

function isValidBrDate(br: string): boolean {
  const parts = br.split('/');
  if (parts.length !== 3) return false;
  const [d, m, y] = parts.map(Number);
  if (!d || !m || !y || y < 1900 || y > 2100) return false;
  if (m < 1 || m > 12) return false;
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/** Abre WhatsApp: tenta app nativo via Rust, fallback browser */
async function abrirWhatsApp(telefone: string) {
  const num = telefone.replace(/\D/g, '');
  const numFull = num.startsWith('55') ? num : `55${num}`;
  // Rust abre o protocolo whatsapp:// com o comando nativo do SO
  // e retorna true se funcionou, false se WhatsApp não está instalado
  try {
    const ok = await invoke<boolean>('open_whatsapp', { phone: numFull });
    if (!ok) {
      await openUrl(`https://wa.me/${numFull}`);
    }
  } catch {
    await openUrl(`https://wa.me/${numFull}`);
  }
}

function focusAtStart(target: HTMLInputElement | React.RefObject<HTMLInputElement | null> | null) {
  if (!target) return;
  const el = 'current' in target ? target.current : target;
  if (!el) return;
  setTimeout(() => {
    el.focus();
    el.setSelectionRange(0, 0);
  }, 40);
}

// ─── Componente de input de data tipo DD/MM/YYYY ─────────────────────
const getHighlight = (cond: boolean) => cond ? 'luxury-input-focused' : '';

function DateInput({ value, onChange, label, externalRef, highlighted, active }: { value: string; onChange: (v: string) => void; label: string; externalRef?: React.RefObject<HTMLInputElement | null>; highlighted?: boolean; active?: boolean }) {
  const localRef = useRef<HTMLInputElement>(null);
  const inputRef = externalRef || localRef;
  const displayValue = value || '__/__/____';

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.setSelectionRange(0, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const isDigit = /^\d$/.test(e.key);
    const formatDate = (v: string) => `${v.slice(0,2)}/${v.slice(2,4)}/${v.slice(4,8)}`;
    
    // Posição no display (0 a 10) -> Posição nos dígitos puros (0 a 8)
    const displayPos = input.selectionStart || 0;
    const rawPos = displayPos <= 2 ? displayPos : displayPos <= 5 ? displayPos - 1 : displayPos - 2;
    const prevRaw = (displayValue.replace(/\//g, '') + '________').slice(0, 8);

    if (isDigit && rawPos < 8) {
      e.preventDefault();
      const d = prevRaw.split('');
      d[rawPos] = e.key;
      const nd = d.join('');
      const newDisp = formatDate(nd);
      onChange(newDisp);

      // Pula as barras no movimento do cursor
      const nextRaw = rawPos + 1;
      const nextDisp = nextRaw <= 2 ? nextRaw : nextRaw <= 4 ? nextRaw + 1 : nextRaw + 2;
      setTimeout(() => input.setSelectionRange(nextDisp, nextDisp), 0);
      return;
    }

    if (e.key === 'Backspace') {
      e.preventDefault();
      const d = prevRaw.split('');
      const posToDel = displayPos > 0 && input.selectionStart === input.selectionEnd ? rawPos - 1 : rawPos;
      if (posToDel < 0) return;
      
      d[posToDel] = '_';
      const nd = d.join('');
      const newDisp = formatDate(nd);
      onChange(newDisp);

      const nextDisp = posToDel <= 2 ? posToDel : posToDel <= 4 ? posToDel + 1 : posToDel + 2;
      setTimeout(() => input.setSelectionRange(nextDisp, nextDisp), 0);
      return;
    }

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Tab' || e.key === 'Enter' || e.key === 'Escape') return;
    e.preventDefault();
  };

  return (
    <div>
      <label className="block text-xs uppercase tracking-widest text-white/40 font-bold mb-1">{label}</label>
      <input
        ref={inputRef}
        type="text"
        className={`luxury-input w-full h-10 font-mono text-center tracking-widest transition-all duration-200 ${active ? 'border-luxury-orange ring-2 ring-luxury-orange/40 bg-luxury-orange/5 scale-[1.02]' : getHighlight(!!highlighted)}`}
        value={displayValue}
        onChange={() => {}}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        maxLength={10}
      />
    </div>
  );
}

// ─── Overlay com ESC + clique fora ───────────────────────────────────
function ModalOverlay({ onClose, zIndex = 200, children }: { onClose: () => void; zIndex?: number; children: React.ReactNode }) {
  const [isMouseDownOnOverlay, setIsMouseDownOnOverlay] = useState(false);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [onClose]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) setIsMouseDownOnOverlay(true);
    else setIsMouseDownOnOverlay(false);
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && isMouseDownOnOverlay) {
      onClose();
    }
    setIsMouseDownOnOverlay(false);
  };

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm"
      style={{ zIndex }}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onKeyDown={e => e.stopPropagation()}
    >
      <div onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body
  );
}

// ─── Modal de confirmação genérico ────────────────────────────────────
function ConfirmModal({ msg, item, onConfirm, onCancel }: { msg: string; item: string; onConfirm: () => void; onCancel: () => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'ArrowDown') { e.preventDefault(); cancelRef.current?.focus(); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); confirmRef.current?.focus(); }
  };

  return (
    <ModalOverlay onClose={onCancel} zIndex={300}>
      <div className="glass-card w-full max-w-sm p-8 border-red-500/20" onKeyDown={handleKeyDown}>
        <h3 className="text-xl font-black italic text-red-500 uppercase tracking-tighter mb-4 leading-none">{msg}</h3>
        <p className="text-white/80 font-medium mb-8 text-sm">{item}</p>
        <div className="space-y-3">
          <button ref={confirmRef} onClick={onConfirm}
            style={{ fontWeight: 700 }}
            className="w-full h-14 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold uppercase tracking-[0.05em] text-sm transition-all shadow-lg shadow-red-600/20 active:scale-95">
            Sim, excluir
          </button>
          <button ref={cancelRef} onClick={onCancel}
            style={{ fontWeight: 700 }}
            className="w-full h-14 rounded-xl border border-white/10 hover:bg-white/5 text-white/40 hover:text-white font-bold uppercase text-sm tracking-[0.05em] transition-all">
            Cancelar
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}

// ══════════════════════════════════════════════════════════════════════
// SUB-TELA: CLIENTES
// ══════════════════════════════════════════════════════════════════════
function TelaClientes({ db, onVerConta, autoFocusClienteId }: { db: any; onVerConta: (c: Cliente, autoFocus?: boolean) => void; autoFocusClienteId?: number | null }) {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<Cliente | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Cliente | null>(null);
  const [deleteBlockedMsg, setDeleteBlockedMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ nome: '', telefone: '', observacao: '' });
  const [formError, setFormError] = useState<string | null>(null);

  // Navegação por teclado
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);
  // 'list' = linha selecionada (orange), 'actions' = botões focados
  const [rowMode, setRowMode] = useState<'list' | 'actions'>('list');
  const [editRowIdx, setEditRowIdx] = useState(-1);
  const [deleteRowIdx, setDeleteRowIdx] = useState(-1);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const novoBtnRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    if (!db) return;
    const rows: Cliente[] = (await db.select("SELECT * FROM clientes ORDER BY nome")) || [];
    setClientes(rows);
  };

  useEffect(() => { load(); }, [db]);
  useEffect(() => {
    setFocusedIdx(null);
    if (autoFocusClienteId != null) {
      const idx = clientes.findIndex(c => c.id === autoFocusClienteId);
      if (idx >= 0) {
        setFocusedIdx(idx);
        setTimeout(() => rowRefs.current[idx]?.focus(), 50);
        return;
      }
    }
  }, [clientes]);

  // Quando modal de edição fecha, volta para actions com foco no lápis
  useEffect(() => {
    if (!isModalOpen && editRowIdx >= 0) {
      setRowMode('actions');
      setTimeout(() => {
        const btns = document.querySelectorAll(`[data-action-row="${editRowIdx}"]`);
        (btns[0] as HTMLElement)?.focus(); // Conta = primeiro
        // Se veio do lapis (idx 1), foca o 1
      }, 50);
    }
  }, [isModalOpen]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isModalOpen || deleteConfirm || deleteBlockedMsg) return;
      const tag = (document.activeElement as HTMLElement)?.tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA';

      // ESC sem nada selecionado e foco na search → limpa ou vai pro sidebar
      if (e.key === 'Escape' && focusedIdx === null && isTyping) {
        e.preventDefault(); e.stopPropagation();
        if (search.trim() !== '') {
          setSearch('');
        } else {
          searchRef.current?.blur();
          setFocusedIdx(null);
          const activeSidebarLink = document.querySelector('aside nav a[class*="bg-luxury-orange"]') as HTMLElement;
          activeSidebarLink?.focus();
        }
        return;
      }

      // ESC sem nada selecionado e sem foco → foca search bar
      if (e.key === 'Escape' && focusedIdx === null && !isTyping) {
        e.preventDefault(); e.stopPropagation();
        setFocusedIdx(-2);
        setTimeout(() => searchRef.current?.focus(), 0);
        return;
      }

      // Enter from sidebar (nothing focused) → focus first row or Novo Cliente
      // Only activate if focus is in sidebar or on body (not already inside main content)
      const isInMain = !!(document.activeElement as HTMLElement)?.closest('main');
      if (e.key === 'Enter' && !isTyping && focusedIdx === null && !isInMain) {
        e.preventDefault(); e.stopPropagation();
        if (filtered.length > 0) {
          setFocusedIdx(0); setRowMode('list');
          setTimeout(() => rowRefs.current[0]?.focus(), 0);
        } else {
          setFocusedIdx(-1);
          novoBtnRef.current?.focus();
        }
        return;
      }

      // Row focused in 'list' mode
      if (focusedIdx !== null && focusedIdx >= 0 && rowMode === 'list') {
        if (e.key === 'ArrowDown') {
          e.preventDefault(); e.stopPropagation();
          const next = Math.min(focusedIdx + 1, filtered.length - 1);
          setFocusedIdx(next);
          rowRefs.current[next]?.focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault(); e.stopPropagation();
          if (focusedIdx === 0) {
            setFocusedIdx(-2);
            setTimeout(() => searchRef.current?.focus(), 0);
          } else {
            const prev = focusedIdx - 1;
            setFocusedIdx(prev);
            rowRefs.current[prev]?.focus();
          }
        } else if (e.key === 'Enter') {
          // Entra em modo actions, foca no botão Conta (primeiro)
          e.preventDefault(); e.stopPropagation();
          setRowMode('actions');
          setTimeout(() => {
            const btns = document.querySelectorAll(`[data-action-row="${focusedIdx}"]`);
            (btns[0] as HTMLElement)?.focus();
          }, 0);
        } else if (e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation();
          setFocusedIdx(-2); setRowMode('list');
          setTimeout(() => searchRef.current?.focus(), 0);
        }
        return;
      }

      // Actions mode: navega entre botões da linha
      if (focusedIdx !== null && focusedIdx >= 0 && rowMode === 'actions') {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault(); e.stopPropagation();
          const btns = Array.from(document.querySelectorAll(`[data-action-row="${focusedIdx}"]`)) as HTMLElement[];
          const cur = btns.indexOf(document.activeElement as HTMLElement);
          if (e.key === 'ArrowRight' && cur < btns.length - 1) btns[cur + 1].focus();
          else if (e.key === 'ArrowLeft' && cur > 0) btns[cur - 1].focus();
        } else if (e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation();
          (document.activeElement as HTMLElement)?.click();
        } else if (e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation();
          // Volta para seleção da linha
          setRowMode('list');
          (document.activeElement as HTMLElement)?.blur();
          setTimeout(() => rowRefs.current[focusedIdx]?.focus(), 0);
        }
        return;
      }

      // Search input focused (-2)
      if (focusedIdx === -2) {
        if (e.key === 'ArrowRight') {
          e.preventDefault(); e.stopPropagation();
          setFocusedIdx(-1);
          setTimeout(() => novoBtnRef.current?.focus(), 0);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault(); e.stopPropagation();
          if (filtered.length > 0) {
            setFocusedIdx(0); setRowMode('list');
            setTimeout(() => rowRefs.current[0]?.focus(), 0);
          }
        } else if (e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation();
          if (search.trim() !== '') {
            setSearch('');
          } else {
            searchRef.current?.blur();
            setFocusedIdx(null);
            const activeSidebarLink = document.querySelector('aside nav a[class*="bg-luxury-orange"]') as HTMLElement;
            activeSidebarLink?.focus();
          }
        }
        return;
      }

      // Novo Cliente button focused (-1)
      if (focusedIdx === -1) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault(); e.stopPropagation();
          setFocusedIdx(-2);
          setTimeout(() => searchRef.current?.focus(), 0);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault(); e.stopPropagation();
          if (filtered.length > 0) {
            setFocusedIdx(0); setRowMode('list');
            setTimeout(() => rowRefs.current[0]?.focus(), 0);
          }
        } else if (e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation();
          openNew();
        } else if (e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation();
          setFocusedIdx(-2);
          setTimeout(() => searchRef.current?.focus(), 0);
        }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [focusedIdx, rowMode, isModalOpen, deleteConfirm, deleteBlockedMsg, clientes, search]);

  const openNew = () => {
    setEditing(null);
    setForm({ nome: '', telefone: '', observacao: '' });
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEdit = (c: Cliente, rowIdx?: number) => {
    setEditing(c);
    if (rowIdx !== undefined) setEditRowIdx(rowIdx);
    setForm({ nome: c.nome, telefone: c.telefone || '', observacao: c.observacao || '' });
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleDeleteRequest = async (c: Cliente, rowIdx?: number) => {
    if (rowIdx !== undefined) setDeleteRowIdx(rowIdx);
    // Block deletion if client has active account
    const rows: any[] = await db.select(
      "SELECT COUNT(*) as cnt FROM vendas_prazo WHERE cliente_id=$1", [c.id]
    );
    const cnt = rows[0]?.cnt || 0;
    if (cnt > 0) {
      setDeleteBlockedMsg(`"${c.nome}" possui conta ativa. Dê baixa ou arquive a conta antes de excluir.`);
      return;
    }
    setDeleteConfirm(c);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nome.trim()) { setFormError('Nome é obrigatório.'); return; }
    try {
      if (editing) {
        await db.execute("UPDATE clientes SET nome=$1, telefone=$2, observacao=$3 WHERE id=$4",
          [form.nome.trim().toUpperCase(), form.telefone || null, form.observacao || null, editing.id]);
      } else {
        await db.execute("INSERT INTO clientes (nome, telefone, observacao) VALUES ($1,$2,$3)",
          [form.nome.trim().toUpperCase(), form.telefone || null, form.observacao || null]);
      }
      setIsModalOpen(false);
      setFormError(null);
      load();
    } catch (err: any) {
      setFormError('Erro ao salvar: ' + String(err?.message || err));
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await db.execute("DELETE FROM clientes WHERE id=$1", [deleteConfirm.id]);
      setDeleteConfirm(null);
      load();
    } catch {
      setDeleteConfirm(null);
    }
  };

  const closeDeleteBlocked = () => {
    setDeleteBlockedMsg(null);
    const idx = deleteRowIdx;
    if (idx >= 0) {
      setRowMode('actions');
      setTimeout(() => {
        const btns = Array.from(document.querySelectorAll(`[data-action-row="${idx}"]`)) as HTMLElement[];
        // lixeira é o último botão (índice 2)
        const lixeira = btns[btns.length - 1];
        lixeira?.focus();
      }, 50);
    }
  };

  const filtered = clientes.filter(c =>
    c.nome.toLowerCase().includes(search.toLowerCase()) ||
    (c.telefone || '').includes(search)
  );

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex items-center gap-3 pr-1">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            ref={searchRef}
            type="text"
            autoComplete="off"
            placeholder="Buscar cliente..."
            className={`luxury-input w-full pl-9 h-10 ${getHighlight(focusedIdx === -2)}`}
            value={search}
            onFocus={() => setFocusedIdx(-2)}
            onBlur={() => { if (focusedIdx === -2) setFocusedIdx(null); }}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <button
          ref={novoBtnRef}
          onClick={openNew}
          onFocus={() => setFocusedIdx(-1)}
          onBlur={() => { if (focusedIdx === -1) setFocusedIdx(null); }}
          className={`btn-primary h-10 px-4 flex items-center gap-2 shrink-0 ${focusedIdx === -1 ? 'ring-2 ring-white/40' : ''}`}
        >
          <Plus size={16} /> Novo Cliente
        </button>
      </div>

      <div className="flex-1 overflow-auto glass-card">
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-luxury-dark-gray/90 backdrop-blur-sm">
            <tr className="border-b border-white/5 text-xs uppercase tracking-widest text-white/40">
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Telefone</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={3} className="px-4 py-8 text-center text-white/30 text-sm">Nenhum cliente cadastrado</td></tr>
            )}
            {filtered.map((c, idx) => (
              <tr
                key={c.id}
                ref={el => { rowRefs.current[idx] = el; }}
                tabIndex={0}
                onFocus={() => setFocusedIdx(idx)}
                onBlur={() => setFocusedIdx(null)}
                className={`relative border-b border-white/5 transition-colors group outline-none cursor-pointer
                  ${focusedIdx === idx ? 'bg-luxury-orange/10' : 'hover:bg-white/5'}`}
              >
                <td className="px-4 py-3 font-semibold text-white">{c.nome}</td>
                <td className="px-4 py-3 text-white/50 font-mono text-sm">{c.telefone || '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1 justify-end">
                    <button
                      data-action-row={idx}
                      tabIndex={-1}
                      onClick={e => { e.stopPropagation(); onVerConta(c); }}
                      className="px-3 py-1.5 rounded-lg bg-luxury-orange/10 hover:bg-luxury-orange text-luxury-orange hover:text-white text-xs font-bold uppercase transition-colors flex items-center gap-1 outline-none focus:ring-1 focus:ring-luxury-orange focus:bg-luxury-orange/20"
                    >
                      <FileText size={12} /> Conta
                    </button>
                    <button
                      data-action-row={idx}
                      tabIndex={-1}
                      onClick={e => { e.stopPropagation(); openEdit(c, idx); }}
                      className="p-1.5 hover:bg-white/10 rounded-lg text-white/40 hover:text-white transition-colors outline-none focus:bg-luxury-orange/20 focus:text-luxury-orange focus:ring-1 focus:ring-luxury-orange"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      data-action-row={idx}
                      tabIndex={-1}
                      onClick={e => { e.stopPropagation(); handleDeleteRequest(c, idx); }}
                      className="p-1.5 hover:bg-red-500/10 rounded-lg text-white/40 hover:text-red-500 transition-colors outline-none focus:bg-red-500/20 focus:text-red-500 focus:ring-1 focus:ring-red-500"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>

              </tr>
            ))}
          </tbody>
        </table>
      </div>


      {/* Modal cliente */}
      {isModalOpen && (
        <ModalOverlay onClose={() => setIsModalOpen(false)}>
          <div
            className="glass-card w-full max-w-md p-8 border-luxury-orange/20"
            onKeyDown={e => {
              e.stopPropagation();
              const active = document.activeElement as HTMLElement;
              const inputs = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('input'));
              const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button[type="button"], button[type="submit"]'));
              const salvarBtn = buttons.find(b => (b as HTMLButtonElement).type === 'submit') ?? buttons[buttons.length - 1];
              const cancelarBtn = buttons.find(b => (b as HTMLButtonElement).type === 'button') ?? buttons[0];
              const inInput = inputs.includes(active);
              const inButton = buttons.includes(active);
              const inputIdx = inputs.indexOf(active);

              if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (inInput) {
                  const isLastInput = inputIdx === inputs.length - 1;
                  if (isLastInput) salvarBtn?.focus();
                  else inputs[inputIdx + 1]?.focus();
                } else if (inButton) {
                  // já está nos botões, não faz nada
                }
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (inInput && inputIdx > 0) inputs[inputIdx - 1]?.focus();
                else if (inButton) inputs[inputs.length - 1]?.focus();
              } else if (e.key === 'ArrowLeft' && inButton) {
                e.preventDefault();
                cancelarBtn?.focus();
              } else if (e.key === 'ArrowRight' && inButton) {
                e.preventDefault();
                salvarBtn?.focus();
              }
            }}
          >
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-2xl font-black italic text-luxury-orange uppercase">{editing ? 'Editar Cliente' : 'Novo Cliente'}</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-white/40 hover:text-white"><X size={22} /></button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs uppercase tracking-widest text-white/40 font-bold mb-1">Nome *</label>
                <input autoFocus type="text" maxLength={60} className="luxury-input w-full h-11"
                  value={form.nome} onChange={e => { setFormError(null); setForm({...form, nome: e.target.value}); }} />
                {formError && <p className="text-red-400 text-xs mt-1">{formError}</p>}
              </div>
              <div>
                <label className="block text-xs uppercase tracking-widest text-white/40 font-bold mb-1">Telefone</label>
                <input type="text" maxLength={20} className="luxury-input w-full h-11 font-mono"
                  value={form.telefone} onChange={e => setForm({...form, telefone: e.target.value.replace(/\D/g,'')})} />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-widest text-white/40 font-bold mb-1">Observação</label>
                <input type="text" maxLength={100} className="luxury-input w-full h-11"
                  value={form.observacao} onChange={e => setForm({...form, observacao: e.target.value})} />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 h-12 border border-white/10 rounded-xl hover:bg-white/5 uppercase text-xs font-bold">Cancelar</button>
                <button type="submit" className="btn-primary flex-1 h-12">Salvar</button>
              </div>
            </form>
          </div>
        </ModalOverlay>
      )}

      {/* Bloqueio de exclusão */}
      {deleteBlockedMsg && (
        <ModalOverlay onClose={closeDeleteBlocked} zIndex={300}>
          <div className="glass-card w-full max-w-sm p-8">
            <h3 className="text-lg font-black italic text-red-400 uppercase mb-3">Não é possível excluir</h3>
            <p className="text-white/70 text-sm mb-6">{deleteBlockedMsg}</p>
            <button autoFocus onClick={closeDeleteBlocked}
              className="w-full h-12 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold uppercase text-xs transition-colors">
              OK
            </button>
          </div>
        </ModalOverlay>
      )}

      {deleteConfirm && <ConfirmModal msg="Excluir cliente?" item={deleteConfirm.nome} onConfirm={handleDelete} onCancel={() => setDeleteConfirm(null)} />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// SUB-TELA: CONTA DO CLIENTE
// ══════════════════════════════════════════════════════════════════════
interface ItemLinha {
  id: number;
  venda_id: number;
  data_venda: string;
  produto_nome: string;
  quantidade: number;
  valor_total: number;
}

function TelaConta({ db, cliente, onVoltar, autoFocusItems }: { db: any; cliente: Cliente; onVoltar: () => void; autoFocusItems?: boolean }) {
  const [itens, setItens] = useState<ItemLinha[]>([]);
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([]);
  const [dataInicial, setDataInicial] = useState(getFirstDayOfMonthStr());
  const [dataFinal, setDataFinal] = useState(getTodayStr());

  // Filtragem em tempo real (JS) baseada nos inputs de data
  const { itensFiltrados, pagamentosFiltrados, totalComprasPeriodo, totalPagoPeriodo, saldoPeriodo } = useMemo(() => {
    // Se a data estiver incompleta (contém _), assumimos limites amplos para não "sumir" com tudo enquanto digita
    const isoIni = (dataInicial || '').includes('_') ? '0000-00-00' : brToIso(dataInicial);
    const isoFim = (dataFinal || '').includes('_') ? '9999-12-31' : brToIso(dataFinal);
    
    const iFiltrados = (itens || []).filter(v => (v.data_venda || '') >= (isoIni || '0000-00-00') && (v.data_venda || '') <= (isoFim || '9999-12-31'));
    const pFiltrados = (pagamentos || []).filter(p => (p.data_pagamento || '') >= (isoIni || '0000-00-00') && (p.data_pagamento || '') <= (isoFim || '9999-12-31'));
    
    const tcp = iFiltrados.reduce((a, i) => a + (Number(i.valor_total) || 0), 0);
    const tpp = pFiltrados.reduce((a, p) => a + (Number(p.valor) || 0), 0);
    
    return {
      itensFiltrados: iFiltrados,
      pagamentosFiltrados: pFiltrados,
      totalComprasPeriodo: tcp,
      totalPagoPeriodo: tpp,
      saldoPeriodo: tcp - tpp
    };
  }, [itens, pagamentos, dataInicial, dataFinal]);

  const [nomeLoja, setNomeLoja] = useState('ERI Salgados');

  // ── Navegação por teclado ──────────────────────────────────────────
  // Zonas: 'header' (whatsapp/imprimir), 'dates' (dataInicial/dataFinal), 'items', 'pag'
  type NavZone = 'header' | 'print_header' | 'dates' | 'items_header' | 'items' | 'pag' | null;
  type PagField = 'header' | 'data' | 'valor' | 'obs' | 'registrar' | 'lista';
  type HeaderField = 'whatsapp' | 'imprimir' | 'arquivar';

  const [navZone, setNavZone] = useState<NavZone>('items');
  const [dateField, setDateField] = useState<'inicial' | 'final'>('inicial');
  const [headerField, setHeaderField] = useState<HeaderField>('imprimir');
  const [focusedItemIdx, setFocusedItemIdx] = useState<number | null>(null);
  const lastFocusedItemIdxRef = useRef<number | null>(null);
  const [itemMenuIdx, setItemMenuIdx] = useState<number | null>(null);
  const [itemMenuFocus, setItemMenuFocus] = useState<0 | 1>(0); // 0=Editar 1=Excluir
  const [pagField, setPagField] = useState<PagField>('data');
  const [inputActive, setInputActive] = useState(false); // Enter → borda laranja, Enter dnv → sai

  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const itemMenuEditRef = useRef<HTMLButtonElement>(null);
  const itemMenuDeleteRef = useRef<HTMLButtonElement>(null);
  const dataInicialRef = useRef<HTMLInputElement>(null);
  const dataFinalRef = useRef<HTMLInputElement>(null);
  const whatsappBtnRef = useRef<HTMLButtonElement>(null);
  const imprimirBtnRef = useRef<HTMLButtonElement>(null);
  const arquivarBtnRef = useRef<HTMLButtonElement>(null);
  const arquivarSimRef = useRef<HTMLButtonElement>(null);
  const arquivarCancelRef = useRef<HTMLButtonElement>(null);
  const pagDataRef = useRef<HTMLInputElement>(null);
  const pagValorRef = useRef<HTMLInputElement>(null);
  const pagObsRef = useRef<HTMLInputElement>(null);
  const registrarBtnRef = useRef<HTMLButtonElement>(null);
  const addItemBtnRef = useRef<HTMLButtonElement>(null);
  const [focusedPagIdx, setFocusedPagIdx] = useState<number | null>(null);
  const [showPagForm, setShowPagForm] = useState(false);
  const togglePagFormBtnRef = useRef<HTMLButtonElement>(null);
  const [modalNavZone, setModalNavZone] = useState<'edit_pag' | 'novo_item' | null>(null);
  const [modalNavField, setModalNavField] = useState<'data' | 'produto' | 'quantidade' | 'valor' | 'obs' | 'salvar' | 'cancelar'>('data');
  const lastFocusedPagIdxRef = useRef<number | null>(null);
  const pagRowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [pagMenuIdx, setPagMenuIdx] = useState<number | null>(null);
  const [pagMenuFocus, setPagMenuFocus] = useState<0 | 1>(0); // 0=Editar 1=Excluir
  const pagMenuEditRef = useRef<HTMLButtonElement>(null);
  const pagMenuDeleteRef = useRef<HTMLButtonElement>(null);

  const editPagDataRef = useRef<HTMLInputElement>(null);
  const editPagValorRef = useRef<HTMLInputElement>(null);
  const editPagObsRef = useRef<HTMLInputElement>(null);
  const editPagCancelBtnRef = useRef<HTMLButtonElement>(null);
  const editPagSaveBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!db) return;
    db.select("SELECT nome_loja FROM configuracoes WHERE id=1")
      .then((r: any[]) => { if (r[0]?.nome_loja) setNomeLoja(r[0].nome_loja); });
  }, [db]);

  // Modais
  const [editItem, setEditItem] = useState<ItemLinha | null>(null);
  const [deleteItem, setDeleteItem] = useState<ItemLinha | null>(null);
  const [editItemForm, setEditItemForm] = useState({ produto_nome: '', quantidade: '', valor_total: '' });
  const [showNovoItem, setShowNovoItem] = useState(false);

  // Estados para Modal Editar Item
  const [eiField, setEiField] = useState<'produto' | 'quantidade' | 'valor' | 'btns'>('produto');
  const [eiBtnFocus, setEiBtnFocus] = useState<0 | 1>(1); // 0=Cancelar, 1=Salvar
  const [_eiInputActive, _setEiInputActive] = useState(false);

  const eiProdutoRef = useRef<HTMLInputElement>(null);
  const eiQuantidadeRef = useRef<HTMLInputElement>(null);
  const eiValorRef = useRef<HTMLInputElement>(null);
  const eiCancelarBtnRef = useRef<HTMLButtonElement>(null);
  const eiSalvarBtnRef = useRef<HTMLButtonElement>(null);
  const [novoItemForm, setNovoItemForm] = useState({ data: getTodayStr(), produto_nome: '', quantidade: '1.000', valor_total: '0,00' });
  const [novoItemError, setNovoItemError] = useState<string | null>(null);
  const [produtoSearch, setProdutoSearch] = useState('');
  const [produtoResults, setProdutoResults] = useState<{id:number;nome:string;preco_venda:number}[]>([]);
  const [produtoResultsIdx, setProdutoResultsIdx] = useState<number>(-1);
  const [produtoSelecionado, setProdutoSelecionado] = useState<{id:number;nome:string;preco_venda:number}|null>(null);

  // Estados busca Editar Item
  const [eiProdutoSearch, setEiProdutoSearch] = useState('');
  const [eiProdutoResults, setEiProdutoResults] = useState<{id:number;nome:string;preco_venda:number}[]>([]);
  const [eiProdutoResultsIdx, setEiProdutoResultsIdx] = useState<number>(-1);
  const [eiProdutoSelecionado, setEiProdutoSelecionado] = useState<{id:number;nome:string;preco_venda:number}|null>(null);

  const [niDataRef, niProdutoRef, niQtyRef, niValorRef, niCancelRef, niSaveRef] = [useRef<any>(null), useRef<any>(null), useRef<any>(null), useRef<any>(null), useRef<any>(null), useRef<any>(null)];

  const [novoPagForm, setNovoPagForm] = useState({ data: getTodayStr(), valor: '0,00', observacao: '' });
  const [deletePag, setDeletePag] = useState<Pagamento | null>(null);
  const [editPag, setEditPag] = useState<Pagamento | null>(null);
  const [editPagForm, setEditPagForm] = useState({ data: '', valor: '', observacao: '' });
  const [pagError, setPagError] = useState<string | null>(null);
  const [itemError, setItemError] = useState<string | null>(null);
  const [zerouAviso, setZerouAviso] = useState(false);
  const [showArquivarConfirm, setShowArquivarConfirm] = useState(false);
  const [arquivarSelected, setArquivarSelected] = useState<'sim' | 'cancelar'>('sim');
  const [showModalImpressao, setShowModalImpressao] = useState(false);

  const load = async () => {
    if (!db) return;
    // Carrega TUDO do cliente para o saldo global estar sempre correto
    const vs: ItemLinha[] = await db.select(
      `SELECT vi.id, vi.venda_id, vp.data_venda, vi.produto_nome, vi.quantidade, vi.valor_total
       FROM vendas_prazo_itens vi
       JOIN vendas_prazo vp ON vp.id = vi.venda_id
       WHERE vp.cliente_id=$1
       ORDER BY vp.data_venda ASC, vi.id ASC`,
      [cliente.id]
    );
    setItens(vs);

    const ps: Pagamento[] = await db.select(
      "SELECT * FROM pagamentos_prazo WHERE cliente_id=$1 ORDER BY data_pagamento ASC, id ASC",
      [cliente.id]
    );
    setPagamentos(ps);
  };

  useEffect(() => {
    load();
    // Inicia foco no primeiro item IMEDIATAMENTE
    setNavZone('items');
    setFocusedItemIdx(0);
    setTimeout(() => {
      if (itemRefs.current[0]) itemRefs.current[0].focus();
    }, 50);
  }, [db, cliente.id]); // Removi dataInicial/Final para evitar resets ao filtrar

  // Reset when list changes
  useEffect(() => {
    // setFocusedItemIdx(null); // REMOVIDO para não perder foco ao carregar
    setItemMenuIdx(null);
  }, [itens]);

  // Auto-focus first item when coming from keyboard navigation
  useEffect(() => {
    if (autoFocusItems && itensFiltrados.length > 0) {
      setNavZone('items');
      setFocusedItemIdx(0);
      setTimeout(() => itemRefs.current[0]?.focus(), 100);
    }
  }, [autoFocusItems, itensFiltrados.length]);

  // Sync item menu focus to refs
  useEffect(() => {
    if (itemMenuIdx !== null) {
      setTimeout(() => {
        if (itemMenuFocus === 0) itemMenuEditRef.current?.focus();
        else itemMenuDeleteRef.current?.focus();
      }, 10);
    }
  }, [itemMenuFocus, itemMenuIdx]);

  // Sync pag menu focus to refs
  useEffect(() => {
    if (pagMenuIdx !== null) {
      setTimeout(() => {
        if (pagMenuFocus === 0) pagMenuEditRef.current?.focus();
        else pagMenuDeleteRef.current?.focus();
      }, 10);
    }
  }, [pagMenuFocus, pagMenuIdx]);

  // Sync modal focus
  useEffect(() => {
    if (modalNavZone === 'edit_pag') {
      setTimeout(() => {
        if (modalNavField === 'data') editPagDataRef.current?.focus();
        else if (modalNavField === 'valor') editPagValorRef.current?.focus();
        else if (modalNavField === 'obs') editPagObsRef.current?.focus();
        else if (modalNavField === 'cancelar') editPagCancelBtnRef.current?.focus();
        else if (modalNavField === 'salvar') editPagSaveBtnRef.current?.focus();
      }, 10);
    } else if (modalNavZone === 'novo_item') {
      setTimeout(() => {
        if (modalNavField === 'data') focusAtStart(niDataRef);
        else if (modalNavField === 'produto') niProdutoRef.current?.focus();
        else if (modalNavField === 'quantidade') niQtyRef.current?.focus();
        else if (modalNavField === 'valor') niValorRef.current?.focus();
        else if (modalNavField === 'cancelar') niCancelRef.current?.focus();
        else if (modalNavField === 'salvar') niSaveRef.current?.focus();
      }, 30);
    }
  }, [modalNavZone, modalNavField, showNovoItem]);

  // Enter from sidebar → go to first item
  useEffect(() => {
    if (navZone === 'items' && focusedItemIdx === null && itensFiltrados.length > 0) {
      setFocusedItemIdx(0);
      setTimeout(() => itemRefs.current[0]?.focus(), 0);
    }
  }, [navZone]);

  // Keep ref in sync with focusedItemIdx
  useEffect(() => {
    if (focusedItemIdx !== null) lastFocusedItemIdxRef.current = focusedItemIdx;
  }, [focusedItemIdx]);

  // Sync pag focus
  useEffect(() => {
    if (navZone === 'pag') {
      if (focusedPagIdx !== null) {
        setTimeout(() => pagRowRefs.current[focusedPagIdx]?.focus(), 10);
      } else if (pagField === 'lista' && pagamentosFiltrados.length === 0) {
        setTimeout(() => togglePagFormBtnRef.current?.focus(), 10);
      }
    }
  }, [navZone, focusedPagIdx, pagField, pagamentosFiltrados.length]);

  // Restore focus after modals close
  useEffect(() => {
    if (!editItem) {
      setItemMenuIdx(null); setItemMenuFocus(0);
      const idx = lastFocusedItemIdxRef.current;
      if (idx !== null) setTimeout(() => itemRefs.current[idx]?.focus(), 50);
    }
  }, [editItem]);

  useEffect(() => {
    if (!deleteItem) {
      setItemMenuIdx(null); setItemMenuFocus(0);
      const idx = lastFocusedItemIdxRef.current;
      if (idx !== null) setTimeout(() => itemRefs.current[idx]?.focus(), 50);
    }
  }, [deleteItem]);

  // Keep pag ref in sync
  useEffect(() => {
    if (focusedPagIdx !== null) lastFocusedPagIdxRef.current = focusedPagIdx;
  }, [focusedPagIdx]);

  useEffect(() => {
    if (!editPag) {
      setPagMenuIdx(null); setPagMenuFocus(0);
      const idx = lastFocusedPagIdxRef.current;
      if (idx !== null) setTimeout(() => pagRowRefs.current[idx]?.focus(), 50);
    }
  }, [editPag]);

  useEffect(() => {
    if (!deletePag) {
      setPagMenuIdx(null); setPagMenuFocus(0);
      const idx = lastFocusedPagIdxRef.current;
      if (idx !== null) setTimeout(() => pagRowRefs.current[idx]?.focus(), 50);
    }
  }, [deletePag]);

  // When pag form opens, focus Data field
  useEffect(() => {
    if (showPagForm) {
      setNavZone('pag');
      setPagField('data');
      setTimeout(() => {
        pagDataRef.current?.focus();
        pagDataRef.current?.setSelectionRange(0, 0);
      }, 50);
    }
  }, [showPagForm]);

  // Restore focus after ModalImpressao closes
  const prevShowModalImpressao = useRef(showModalImpressao);
  useEffect(() => {
    if (!showModalImpressao && prevShowModalImpressao.current) {
      setTimeout(() => imprimirBtnRef.current?.focus(), 50);
    }
    prevShowModalImpressao.current = showModalImpressao;
  }, [showModalImpressao]);

  // Focus the right input when zone/field changes
  useEffect(() => {
    if (navZone === 'header') {
      setTimeout(() => {
        if (headerField === 'whatsapp') whatsappBtnRef.current?.focus();
        else if (headerField === 'arquivar') arquivarBtnRef.current?.focus();
        else imprimirBtnRef.current?.focus();
      }, 0);
    }
    if (navZone === 'dates') {
      setTimeout(() => {
        const ref = dateField === 'inicial' ? dataInicialRef : dataFinalRef;
        if (ref.current) {
          ref.current.focus();
          ref.current.setSelectionRange(0, 0);
        }
      }, 0);
    }
    if (navZone === 'pag' && showPagForm) {
      setTimeout(() => {
        if (pagField === 'data') {
          pagDataRef.current?.focus();
          pagDataRef.current?.setSelectionRange(0, 0);
        } else if (pagField === 'valor') {
          pagValorRef.current?.focus();
          pagValorRef.current?.select();
        } else if (pagField === 'obs') {
          pagObsRef.current?.focus();
        } else if (pagField === 'registrar') {
          registrarBtnRef.current?.focus();
        }
      }, 0);
    }
  }, [navZone, headerField, dateField, pagField, showPagForm]);
  useEffect(() => {
    if (!editItem) return;
    setTimeout(() => {
      if (eiField === 'btns') {
        if (eiBtnFocus === 0) eiCancelarBtnRef.current?.focus();
        else eiSalvarBtnRef.current?.focus();
      } else {
        if (eiField === 'produto') eiProdutoRef.current?.focus();
        else if (eiField === 'quantidade') eiQuantidadeRef.current?.focus();
        else if (eiField === 'valor') eiValorRef.current?.focus();
      }
    }, 10);
  }, [eiField, eiBtnFocus, editItem]);

  useEffect(() => {
    if (editItem) {
      setEiField('produto');
      setEiBtnFocus(1);
      _setEiInputActive(true);
    }
  }, [editItem]);

  // Arquivar confirm: focus sim button on open, follow selection
  useEffect(() => {
    if (!showArquivarConfirm) return;
    setArquivarSelected('sim');
    setTimeout(() => arquivarSimRef.current?.focus(), 50);
  }, [showArquivarConfirm]);

  useEffect(() => {
    if (!showArquivarConfirm) return;
    if (arquivarSelected === 'sim') arquivarSimRef.current?.focus();
    else arquivarCancelRef.current?.focus();
  }, [arquivarSelected, showArquivarConfirm]);

  // Main keyboard handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Block if any modal open
      if (editItem || deleteItem || showNovoItem || (editPag && modalNavZone !== 'edit_pag') || deletePag || showArquivarConfirm || showModalImpressao) return;

      // ── Item inline actions mode ──
      if (itemMenuIdx !== null) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault(); e.stopPropagation();
          setItemMenuFocus(f => f === 0 ? 1 : 0);
        } else if (e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation();
          const item = itensFiltrados[itemMenuIdx];
          if (itemMenuFocus === 0) { openEditItem(item); setItemMenuIdx(null); }
          else { setDeleteItem(item); setItemMenuIdx(null); }
        } else if (e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation();
          const savedIdx = itemMenuIdx;
          setItemMenuIdx(null);
          setTimeout(() => itemRefs.current[savedIdx]?.focus(), 10);
        }
        return;
      }

      // ── Pagamento inline actions mode ──
      if (pagMenuIdx !== null) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault(); e.stopPropagation();
          setPagMenuFocus(f => f === 0 ? 1 : 0);
        } else if (e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation();
          const p = pagamentosFiltrados[pagMenuIdx];
          if (pagMenuFocus === 0) { openEditPag(p); setPagMenuIdx(null); }
          else { setDeletePag(p); setPagMenuIdx(null); }
        } else if (e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation();
          const savedIdx = pagMenuIdx;
          setPagMenuIdx(null);
          setTimeout(() => pagRowRefs.current[savedIdx]?.focus(), 10);
        }
        return;
      }

      // ── Input active (borda laranja) ──
      if (inputActive) {
        if (e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation();
          setInputActive(false);
          (document.activeElement as HTMLElement)?.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation();
          setInputActive(false);
          (document.activeElement as HTMLElement)?.blur();
        }
        return; // let the input handle typing
      }

      // ── Zona: header (IMPRIMIR / WHATSAPP) ──
      if (navZone === 'header') {
        if (e.key === 'ArrowLeft') {
          e.preventDefault(); e.stopPropagation();
          if (headerField === 'arquivar') setHeaderField('imprimir');
          else setHeaderField('whatsapp');
        } else if (e.key === 'ArrowRight') {
          e.preventDefault(); e.stopPropagation();
          if (headerField === 'whatsapp') setHeaderField('imprimir');
          else if (headerField === 'imprimir' && saldoGlobal <= 0) setHeaderField('arquivar');
        }
        else if (e.key === 'ArrowDown') {
          e.preventDefault(); e.stopPropagation();
          setNavZone('dates'); setDateField('inicial');
        } else if (e.key === 'ArrowUp') {
          e.preventDefault(); e.stopPropagation();
          // Topo da tela — não faz nada
        } else if (e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation();
          if (headerField === 'whatsapp' && cliente.telefone) abrirWhatsApp(cliente.telefone);
          else if (headerField === 'arquivar') setShowArquivarConfirm(true);
          else setShowModalImpressao(true);
        } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setNavZone(null); (document.activeElement as HTMLElement)?.blur(); document.body.setAttribute('data-esc-handled', '1'); setTimeout(() => document.body.removeAttribute('data-esc-handled'), 0); }
        return;
      }

      // ── Zona: dates ──
      if (navZone === 'dates') {
        if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); setDateField('inicial'); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); setDateField('final'); }
        else if (e.key === 'ArrowUp') {
          e.preventDefault(); e.stopPropagation();
          setNavZone('header'); setHeaderField('imprimir');
        }
        else if (e.key === 'ArrowDown') {
          e.preventDefault(); e.stopPropagation();
          setNavZone('items_header'); setFocusedItemIdx(null);
        }
        else if (e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation();
          setInputActive(true);
          if (dateField === 'inicial') focusAtStart(dataInicialRef);
          else focusAtStart(dataFinalRef);
        }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setNavZone(null); setInputActive(false); (document.activeElement as HTMLElement)?.blur(); document.body.setAttribute('data-esc-handled', '1'); setTimeout(() => document.body.removeAttribute('data-esc-handled'), 0); }
        return;
      }

      // ── Zona: items_header (+ ITEM) ──
      if (navZone === 'items_header') {
        if (e.key === 'ArrowUp') {
          e.preventDefault(); e.stopPropagation();
          setNavZone('dates'); setDateField('inicial');
        } else if (e.key === 'ArrowDown') {
          e.preventDefault(); e.stopPropagation();
          if (itensFiltrados.length > 0) {
            setNavZone('items'); setFocusedItemIdx(0);
          } else {
            setNavZone('pag'); setPagField('data');
          }
        } else if (e.key === 'ArrowRight' || e.key === 'Tab') {
          e.preventDefault(); e.stopPropagation();
          setNavZone('pag'); setPagField('header');
        } else if (e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation();
          addItemBtnRef.current?.click();
        } else if (e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation(); setNavZone(null); (document.activeElement as HTMLElement)?.blur(); document.body.setAttribute('data-esc-handled', '1'); setTimeout(() => document.body.removeAttribute('data-esc-handled'), 0);
        }
        return;
      }

      // ── Zona: items ──
      if (navZone === 'items') {
        if (focusedItemIdx !== null) {
          if (e.key === 'ArrowDown') {
            e.preventDefault(); e.stopPropagation();
            if (focusedItemIdx < itensFiltrados.length - 1) {
              const next = focusedItemIdx + 1;
              setFocusedItemIdx(next);
            }
          } else if (e.key === 'ArrowUp') {
            e.preventDefault(); e.stopPropagation();
            if (focusedItemIdx > 0) {
              const prev = focusedItemIdx - 1;
              setFocusedItemIdx(prev);
            } else {
              setNavZone('items_header'); setFocusedItemIdx(null);
            }
          } else if (e.key === 'ArrowRight' || e.key === 'Tab') {
            e.preventDefault(); e.stopPropagation();
            setNavZone('pag');
            setPagField('header');
            setFocusedPagIdx(null);
          } else if (e.key === 'Enter') {
            e.preventDefault(); e.stopPropagation();
            setItemMenuIdx(focusedItemIdx);
            setItemMenuFocus(0);
          } else if (e.key === 'Escape') {
            e.preventDefault(); e.stopPropagation();
            document.body.setAttribute('data-esc-handled', '1'); setTimeout(() => document.body.removeAttribute('data-esc-handled'), 0);
            setFocusedItemIdx(null);
            (document.activeElement as HTMLElement)?.blur();
            onVoltar();
          }
        }
        return;
      }

      // ── Zona: Modal Editar Pagamento ──
      if (modalNavZone === 'edit_pag') {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (modalNavField === 'data') setModalNavField('valor');
          else if (modalNavField === 'valor') setModalNavField('obs');
          else if (modalNavField === 'obs') setModalNavField('salvar');
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (modalNavField === 'valor') setModalNavField('data');
          else if (modalNavField === 'obs') setModalNavField('valor');
          else if (modalNavField === 'salvar' || modalNavField === 'cancelar') setModalNavField('obs');
        } else if (e.key === 'ArrowLeft') {
          if (modalNavField === 'salvar') { e.preventDefault(); setModalNavField('cancelar'); }
        } else if (e.key === 'ArrowRight') {
          if (modalNavField === 'cancelar') { e.preventDefault(); setModalNavField('salvar'); }
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (modalNavField === 'data') setModalNavField('valor');
          else if (modalNavField === 'valor') setModalNavField('obs');
          else if (modalNavField === 'obs') setModalNavField('salvar');
          else if (modalNavField === 'cancelar') closeEditPag();
          else if (modalNavField === 'salvar') { 
            const submitBtn = editPagSaveBtnRef.current;
            if (submitBtn) submitBtn.click();
          }
        } else if (e.key === 'Escape') {
          e.preventDefault(); closeEditPag();
        }
        return;
      }

      // ── Zona: pag (PAGAMENTOS) ──
      if (navZone === 'pag') {
        if (e.key === 'ArrowLeft') {
          e.preventDefault(); e.stopPropagation();
          if (showPagForm && pagField === 'valor') {
            setPagField('data');
          } else if (pagField === 'header' && !showPagForm) {
            // From +Novo button → back to +Item button
            setNavZone('items_header');
          } else if (!showPagForm) {
            setNavZone('items');
            if (itensFiltrados.length > 0) setFocusedItemIdx(lastFocusedItemIdxRef.current ?? 0);
          }
          return;
        }

        if (e.key === 'ArrowRight') {
          e.preventDefault(); e.stopPropagation();
          // Se form aberto e foco em Data → vai para Valor
          if (showPagForm && pagField === 'data') {
            setPagField('valor');
            setTimeout(() => { pagValorRef.current?.focus(); pagValorRef.current?.select(); }, 0);
          }
          return;
        }

        if (e.key === 'Tab') {
          e.preventDefault(); e.stopPropagation();
          if (showPagForm) {
            if (e.shiftKey) {
              if (pagField === 'valor') setPagField('data');
              else if (pagField === 'obs') setPagField('valor');
              else if (pagField === 'registrar') setPagField('obs');
            } else {
              if (pagField === 'data') setPagField('valor');
              else if (pagField === 'valor') setPagField('obs');
              else if (pagField === 'obs') setPagField('registrar');
            }
          }
          return;
        }

        if (e.key === 'ArrowDown') {
          e.preventDefault(); e.stopPropagation();
          if (pagField === 'header') {
            if (showPagForm) setPagField('data');
            else if (pagamentosFiltrados.length > 0) { setPagField('lista'); setFocusedPagIdx(0); }
          } else if (pagField === 'data' || pagField === 'valor') {
            setPagField('obs');
          } else if (pagField === 'obs') {
            setPagField('registrar');
          } else if (pagField === 'registrar') {
            if (pagamentosFiltrados.length > 0) { setPagField('lista'); setFocusedPagIdx(0); }
          } else if (pagField === 'lista') {
            if (focusedPagIdx !== null && focusedPagIdx < pagamentosFiltrados.length - 1) {
              setFocusedPagIdx(focusedPagIdx + 1);
            }
          }
        } else if (e.key === 'ArrowUp') {
          e.preventDefault(); e.stopPropagation();
          if (pagField === 'lista') {
            if (focusedPagIdx !== null && focusedPagIdx > 0) {
              setFocusedPagIdx(focusedPagIdx - 1);
            } else {
              setPagField(showPagForm ? 'registrar' : 'header'); setFocusedPagIdx(null);
            }
          } else if (pagField === 'registrar') {
            setPagField('obs');
          } else if (pagField === 'obs') {
            setPagField('data');
          } else if (pagField === 'data' || pagField === 'valor') {
            setPagField('header');
          } else if (pagField === 'header') {
            setNavZone('items_header');
          }
        } else if (e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation();
          if (pagField === 'header') togglePagFormBtnRef.current?.click();
          else if (pagField === 'registrar') registrarBtnRef.current?.click();
          else if (pagField === 'lista' && focusedPagIdx !== null) {
            setPagMenuIdx(focusedPagIdx); setPagMenuFocus(0);
          } else if (showPagForm) {
            if (pagField === 'data') setPagField('valor');
            else if (pagField === 'valor') setPagField('obs');
            else if (pagField === 'obs') setPagField('registrar');
          }
        } else if (e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation();
          setInputActive(false);
          if (showPagForm) {
            // Fecha o form e volta foco para o botão NOVO/FECHAR
            setShowPagForm(false);
            setPagField('header');
            setTimeout(() => togglePagFormBtnRef.current?.focus(), 50);
          } else {
            (document.activeElement as HTMLElement)?.blur();
            document.body.setAttribute('data-esc-handled', '1'); setTimeout(() => document.body.removeAttribute('data-esc-handled'), 0);
            onVoltar();
          }
        }
        return;
      }

      // ── Nenhuma zona ativa ──
      const tag = (document.activeElement as HTMLElement)?.tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA';
      if (e.key === 'Enter' && !isTyping) {
        e.preventDefault(); e.stopPropagation();
        setNavZone('items');
      }
      // ESC sem zona ativa → volta para TelaClientes (restaura foco no cliente)
      if (e.key === 'Escape' && !isTyping) {
        e.preventDefault(); e.stopPropagation();
        document.body.setAttribute('data-esc-handled', '1');
        setTimeout(() => document.body.removeAttribute('data-esc-handled'), 0);
        onVoltar();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [navZone, headerField, dateField, focusedItemIdx, itemMenuIdx, itemMenuFocus,
      pagField, inputActive, focusedPagIdx, pagMenuIdx, pagMenuFocus,
      itensFiltrados, pagamentosFiltrados, editItem, deleteItem, showNovoItem,
      editPag, deletePag, showArquivarConfirm, showModalImpressao, cliente.telefone,
      modalNavZone, modalNavField, showPagForm]);

  useEffect(() => {
    if (!editItem) return;
    const h = (e: KeyboardEvent) => {
      // Navegação lista produtos busca (Edição)
      if (eiProdutoResults.length > 0 && !eiProdutoSelecionado) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setEiProdutoResultsIdx(p => (p + 1) % eiProdutoResults.length);
          return;
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setEiProdutoResultsIdx(p => (p - 1 + eiProdutoResults.length) % eiProdutoResults.length);
          return;
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const targetIdx = eiProdutoResultsIdx === -1 ? 0 : eiProdutoResultsIdx;
          const p = eiProdutoResults[targetIdx];
          if (p) {
            const qty = parseInt(editItemForm.quantidade) || 1;
            const total = (p.preco_venda * qty).toFixed(2).replace('.', ',');
            setEiProdutoSelecionado(p);
            setEiProdutoSearch(p.nome);
            setEiProdutoResults([]);
            setEiProdutoResultsIdx(-1);
            setEditItemForm(f => ({...f, produto_nome: p.nome, valor_total: total}));
            setEiField('quantidade');
          }
          return;
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setEiProdutoResults([]);
          setEiProdutoResultsIdx(-1);
          return;
        }
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (eiField === 'produto') setEiField('quantidade');
        else if (eiField === 'quantidade') setEiField('valor');
        else if (eiField === 'valor') setEiField('btns');
        else if (eiField === 'btns') setEiBtnFocus(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (eiField === 'btns') setEiField('valor');
        else if (eiField === 'valor') setEiField('quantidade');
        else if (eiField === 'quantidade') setEiField('produto');
      } else if (e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation();
        if (eiField === 'produto') setEiField('quantidade');
        else if (eiField === 'quantidade') setEiField('valor');
        else if (eiField === 'valor') setEiField('btns');
        else if (eiField === 'btns') {
          if (eiBtnFocus === 0) closeEditItem();
          else eiSalvarBtnRef.current?.click();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        closeEditItem();
      }
    };

    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [editItem, eiField, eiBtnFocus, editItemForm, focusedItemIdx, eiProdutoResults, eiProdutoResultsIdx, eiProdutoSelecionado, navZone, pagField]);

  useEffect(() => {
    if (navZone === 'header') {
      if (headerField === 'whatsapp') whatsappBtnRef.current?.focus();
      else imprimirBtnRef.current?.focus();
    } else if (navZone === 'items_header') {
      addItemBtnRef.current?.focus();
    } else if (navZone === 'pag' && pagField === 'header') {
      togglePagFormBtnRef.current?.focus();
    } else if (navZone === 'items' && focusedItemIdx !== null) {
      itemRefs.current[focusedItemIdx]?.focus();
    } else if (navZone === 'pag' && pagField === 'lista' && focusedPagIdx !== null) {
      pagRowRefs.current[focusedPagIdx]?.focus();
    }
  }, [navZone, headerField, pagField, focusedItemIdx, focusedPagIdx]);

  const openEditItem = async (item: ItemLinha) => {
    setEditItem(item);
    setEditItemForm({ produto_nome: item.produto_nome, quantidade: String(item.quantidade), valor_total: item.valor_total.toFixed(2).replace('.',',') });
    setNavZone(null);
    setEiField('produto');
    setItemError(null);
    setEiProdutoResults([]);
    setEiProdutoResultsIdx(-1);
    
    // Tenta encontrar o produto no banco
    const p: any[] = await db.select("SELECT id, nome, preco_venda FROM produtos WHERE nome = $1 LIMIT 1", [item.produto_nome]);
    if (p.length > 0) {
      setEiProdutoSelecionado(p[0]);
      setEiProdutoSearch(p[0].nome);
    } else {
      setEiProdutoSelecionado(null);
      setEiProdutoSearch(item.produto_nome);
    }
  };

  const closeEditItem = () => {
    setEditItem(null);
    setEiProdutoSearch('');
    setEiProdutoSelecionado(null);
    setEiProdutoResults([]);
    setNavZone('items');
    const idx = focusedItemIdx ?? 0;
    setTimeout(() => {
      itemRefs.current[idx]?.focus();
    }, 50);
  };

  const saveEditItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editItem) return;
    if (!eiProdutoSelecionado) { setItemError('Selecione um produto da lista.'); return; }
    
    setItemError(null);
    const qty = parseInt(editItemForm.quantidade) || 0;
    const val = parseCurrencyToNumber(editItemForm.valor_total) || 0;
    
    if (qty <= 0 || val <= 0) {
      setItemError("Quantidade e valor devem ser maiores que zero.");
      return;
    }

    await db.execute("UPDATE vendas_prazo_itens SET produto_nome=$1, quantidade=$2, valor_total=$3 WHERE id=$4",
      [eiProdutoSelecionado.nome.toUpperCase(), qty, val, editItem.id]);
    
    const rows: VendaPrazoItem[] = await db.select("SELECT * FROM vendas_prazo_itens WHERE venda_id=$1", [editItem.venda_id]);
    const novoTotal = rows.reduce((a, i) => a + (i.id === editItem.id ? val : i.valor_total), 0);
    await db.execute("UPDATE vendas_prazo SET total=$1 WHERE id=$2", [novoTotal, editItem.venda_id]);
    load();
    closeEditItem();
  };

  const handleDeleteItem = async () => {
    if (!deleteItem) return;
    await db.execute("DELETE FROM vendas_prazo_itens WHERE id=$1", [deleteItem.id]);
    const rows: VendaPrazoItem[] = await db.select("SELECT * FROM vendas_prazo_itens WHERE venda_id=$1", [deleteItem.venda_id]);
    if (rows.length === 0) {
      await db.execute("DELETE FROM vendas_prazo WHERE id=$1", [deleteItem.venda_id]);
    } else {
      await db.execute("UPDATE vendas_prazo SET total=$1 WHERE id=$2", [rows.reduce((a,i) => a+i.valor_total, 0), deleteItem.venda_id]);
    }
    setDeleteItem(null);
    load();
  };
  const openNovoItem = () => {
    setNovoItemForm({ data: getTodayStr(), produto_nome: '', quantidade: '1.000', valor_total: '0,00' });
    setProdutoSearch('');
    setProdutoSelecionado(null);
    setNovoItemError(null);
    setShowNovoItem(true);
    setNavZone(null);
    setModalNavZone('novo_item');
    setModalNavField('data');
  };

  useEffect(() => {
    if (!showNovoItem) return;
    const handler = (e: KeyboardEvent) => {
      if (modalNavZone !== 'novo_item') return;

      // Navegação lista produtos busca
      if (produtoResults.length > 0 && !produtoSelecionado) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setProdutoResultsIdx(p => (p + 1) % produtoResults.length);
          return;
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setProdutoResultsIdx(p => (p - 1 + produtoResults.length) % produtoResults.length);
          return;
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const targetIdx = produtoResultsIdx === -1 ? 0 : produtoResultsIdx;
          const p = produtoResults[targetIdx];
          if (p) {
            const qty = parseFloat(novoItemForm.quantidade.replace(',', '.')) || 1;
            const total = (p.preco_venda * qty).toFixed(2).replace('.', ',');
            setProdutoSelecionado(p);
            setProdutoSearch(p.nome);
            setProdutoResults([]);
            setProdutoResultsIdx(-1);
            setNovoItemForm(f => ({...f, produto_nome: p.nome, valor_total: total}));
            setModalNavField('quantidade');
          }
          return;
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setProdutoResults([]);
          setProdutoResultsIdx(-1);
          return;
        }
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (modalNavField === 'data') setModalNavField('produto');
        else if (modalNavField === 'produto') setModalNavField('quantidade');
        else if (modalNavField === 'quantidade') setModalNavField('valor');
        else if (modalNavField === 'valor') setModalNavField('salvar');
        else if (modalNavField === 'cancelar') setModalNavField('salvar');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (modalNavField === 'salvar') setModalNavField('valor');
        else if (modalNavField === 'cancelar') setModalNavField('valor');
        else if (modalNavField === 'valor') setModalNavField('quantidade');
        else if (modalNavField === 'quantidade') setModalNavField('produto');
        else if (modalNavField === 'produto') setModalNavField('data');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (modalNavField === 'data') setModalNavField('produto');
        else if (modalNavField === 'produto') setModalNavField('quantidade');
        else if (modalNavField === 'quantidade') setModalNavField('valor');
        else if (modalNavField === 'valor') setModalNavField('salvar');
        else if (modalNavField === 'cancelar') { setShowNovoItem(false); setModalNavZone(null); setNavZone('items'); }
        else if (modalNavField === 'salvar') niSaveRef.current?.click();
      } else if (e.key === 'Escape') {
        e.preventDefault(); setShowNovoItem(false); setModalNavZone(null); setNavZone('items');
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [showNovoItem, modalNavField, modalNavZone, novoItemForm, produtoSearch, produtoResults, produtoResultsIdx, produtoSelecionado]);

  const salvarNovoItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setNovoItemError(null);
    if (!produtoSelecionado) { setNovoItemError('Selecione um produto da lista.'); return; }
    if (!novoItemForm.produto_nome.trim()) { setNovoItemError('Escolha um produto.'); return; }
    const qty = parseFloat(novoItemForm.quantidade.replace(',', '.')) || 1;
    const val = parseCurrencyToNumber(novoItemForm.valor_total);
    if (!val || val <= 0) { setNovoItemError('Valor inválido.'); return; }
    if (!isValidBrDate(novoItemForm.data)) { setNovoItemError('Data inválida.'); return; }

    const isoData = brToIso(novoItemForm.data);
    // Cria uma venda_prazo para esse lançamento avulso
    const res = await db.execute(
      "INSERT INTO vendas_prazo (cliente_id, data_venda, total) VALUES ($1, $2, $3)",
      [cliente.id, isoData, val]
    );
    await db.execute(
      "INSERT INTO vendas_prazo_itens (venda_id, produto_nome, quantidade, valor_total) VALUES ($1, $2, $3, $4)",
      [res.lastInsertId, novoItemForm.produto_nome.trim().toUpperCase(), qty, val]
    );
    setShowNovoItem(false);
    setModalNavZone(null);
    setNavZone('items');
    setFocusedItemIdx(0);
    setTimeout(() => {
      itemRefs.current[0]?.focus();
    }, 100);
    load();
  };

  const salvarPagamento = async (e: React.FormEvent) => {
    e.preventDefault();
    setPagError(null);
    const val = parseCurrencyToNumber(novoPagForm.valor);
    if (!val || val <= 0) {
      setPagError('Valor inválido.');
      setNavZone('pag');
      setPagField('valor');
      setNovoPagForm(prev => ({ ...prev, valor: '' }));
      setTimeout(() => { pagValorRef.current?.focus(); }, 0);
      return;
    }
    if (!isValidBrDate(novoPagForm.data)) {
      setPagError('Data inválida.');
      setNavZone('pag');
      setPagField('data');
      setTimeout(() => { pagDataRef.current?.focus(); pagDataRef.current?.setSelectionRange(0, 0); }, 0);
      return;
    }
    if (saldoGlobal <= 0) {
      setPagError('Conta já está zerada.');
      return;
    }
    if (val > saldoGlobal + 0.001) {
      setPagError(`Limite (Dívida Total): R$ ${saldoGlobal.toFixed(2).replace('.', ',')}`);
      return;
    }

    const isoData = brToIso(novoPagForm.data);
    const isoInicial = brToIso(dataInicial);
    const isoFinal = brToIso(dataFinal);

    await db.execute("INSERT INTO pagamentos_prazo (cliente_id, data_pagamento, valor, observacao) VALUES ($1,$2,$3,$4)",
      [cliente.id, isoData, val, novoPagForm.observacao || null]);

    // Verifica se zera: total compras do mês do pagamento - total pago no mesmo mês
    const mesInicio = isoData.slice(0,7) + '-01';
    const mesFim = isoData.slice(0,7) + '-31';
    const comprasMes: any[] = await db.select(
      "SELECT COALESCE(SUM(total),0) as total FROM vendas_prazo WHERE cliente_id=$1 AND data_venda>=$2 AND data_venda<=$3",
      [cliente.id, mesInicio, mesFim]
    );
    const pagsMes: any[] = await db.select(
      "SELECT COALESCE(SUM(valor),0) as total FROM pagamentos_prazo WHERE cliente_id=$1 AND data_pagamento>=$2 AND data_pagamento<=$3",
      [cliente.id, mesInicio, mesFim]
    );
    const totalComprasMes = comprasMes[0]?.total || 0;
    const totalPagoMes = pagsMes[0]?.total || 0;

    // Só avisa se o pagamento foi no mesmo período filtrado
    if (isoData >= isoInicial && isoData <= isoFinal && totalComprasMes > 0 && totalPagoMes >= totalComprasMes) {
      setZerouAviso(true);
    }

    setNovoPagForm({ data: getTodayStr(), valor: '', observacao: '' });
    setShowPagForm(false);
    setNavZone('pag');
    setPagField('lista');
    setFocusedPagIdx(0);
    setTimeout(() => {
      pagRowRefs.current[0]?.focus();
    }, 100);
    load();
  };

  const handleDeletePag = async () => {
    if (!deletePag) return;
    await db.execute("DELETE FROM pagamentos_prazo WHERE id=$1", [deletePag.id]);
    setDeletePag(null);
    load();
  };

  const openEditPag = (p: Pagamento, pidx?: number) => {
    if (pidx !== undefined) setFocusedPagIdx(pidx);
    setEditPag(p);
    const valorStr = (Number(p.valor) || 0).toFixed(2).replace('.', ',');
    setEditPagForm({ data: isoToBr(p.data_pagamento || ''), valor: valorStr, observacao: p.observacao || '' });
    setNavZone(null); // Desativar zona principal
    setModalNavZone('edit_pag');
    setModalNavField('data');
  };

  const closeEditPag = () => {
    setEditPag(null);
    setModalNavZone(null);
    setNavZone('pag');
    setPagField('lista');
    setFocusedPagIdx(0);
    setTimeout(() => {
      pagRowRefs.current[0]?.focus();
    }, 50);
  };

  const saveEditPag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editPag) return;
    const val = parseCurrencyToNumber(editPagForm.valor);
    if (!val || val <= 0) {
      setPagError("O valor deve ser maior que zero.");
      return;
    }
    if (!isValidBrDate(editPagForm.data)) return;
    await db.execute(
      "UPDATE pagamentos_prazo SET data_pagamento=$1, valor=$2, observacao=$3 WHERE id=$4",
      [brToIso(editPagForm.data), val, editPagForm.observacao || null, editPag.id]
    );
    closeEditPag();
    load();
  };

  const handleArquivar = async () => {
    // Calcula totais globais (sem filtro de data) para arquivar
    const comprasAll: any[] = await db.select(
      "SELECT COALESCE(SUM(total),0) as total FROM vendas_prazo WHERE cliente_id=$1",
      [cliente.id]
    );
    const pagosAll: any[] = await db.select(
      "SELECT COALESCE(SUM(valor),0) as total FROM pagamentos_prazo WHERE cliente_id=$1",
      [cliente.id]
    );
    const tc = comprasAll[0]?.total || 0;
    const tp = pagosAll[0]?.total || 0;
    const hoje = new Date();
    const isoHoje = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}-${String(hoje.getDate()).padStart(2,'0')}`;
    const codigoArq = `ARQ-${isoHoje.replace(/-/g,'')}-${String(hoje.getHours()).padStart(2,'0')}${String(hoje.getMinutes()).padStart(2,'0')}`;

    // Busca itens de forma mais segura: primeiro as vendas, depois os itens de cada venda
    const vs: any[] = await db.select("SELECT id, data_venda FROM vendas_prazo WHERE cliente_id=$1", [cliente.id]);
    const todosItens: any[] = [];
    for (const v of vs) {
      const its: any[] = await db.select("SELECT * FROM vendas_prazo_itens WHERE venda_id=$1", [v.id]);
      todosItens.push(...its.map(i => ({ ...i, data_venda: v.data_venda })));
    }

    const todosPags: Pagamento[] = await db.select(
      "SELECT * FROM pagamentos_prazo WHERE cliente_id=$1 ORDER BY data_pagamento ASC",
      [cliente.id]
    );

    if (tc > 0 && todosItens.length === 0) {
      alert("Erro crítico: Não foi possível recuperar os itens da conta para arquivamento. Operação abortada para segurança dos dados.");
      return;
    }

    await db.execute(
      "INSERT INTO contas_arquivadas (cliente_id, cliente_nome, cliente_telefone, data_arquivo, total_compras, total_pago, itens_json, pagamentos_json, codigo_arquivamento) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [cliente.id, cliente.nome, cliente.telefone || null, isoHoje, tc, tp, JSON.stringify(todosItens), JSON.stringify(todosPags), codigoArq]
    );
    // Limpa vendas e pagamentos do cliente
    await db.execute("DELETE FROM vendas_prazo_itens WHERE venda_id IN (SELECT id FROM vendas_prazo WHERE cliente_id=$1)", [cliente.id]);
    await db.execute("DELETE FROM vendas_prazo WHERE cliente_id=$1", [cliente.id]);
    await db.execute("DELETE FROM pagamentos_prazo WHERE cliente_id=$1", [cliente.id]);
    setShowArquivarConfirm(false);
    onVoltar();
  };

  // Saldo global (sem filtro de data)
  const [resumoGlobal, setResumoGlobal] = useState({ compras: 0, pago: 0, saldo: 0 });
  useEffect(() => {
    if (!db) return;
    (async () => {
      const c: any[] = await db.select("SELECT COALESCE(SUM(total),0) as total FROM vendas_prazo WHERE cliente_id=$1", [cliente.id]);
      const p: any[] = await db.select("SELECT COALESCE(SUM(valor),0) as total FROM pagamentos_prazo WHERE cliente_id=$1", [cliente.id]);
      const tc = c[0]?.total || 0;
      const tp = p[0]?.total || 0;
      setResumoGlobal({ compras: tc, pago: tp, saldo: tc - tp });
    })();
  }, [db, cliente.id, pagamentos, itens]);

  const saldoGlobal = resumoGlobal.saldo || 0;

  return (
    <div className="flex flex-col h-full gap-3 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 shrink-0 py-1 px-0.5">
        <button onClick={onVoltar} className="text-white/40 hover:text-white transition-colors text-sm font-bold uppercase tracking-widest flex items-center gap-1">
          ← Clientes
        </button>
        <span className="text-white/20">/</span>
        <h2 className="text-xl font-black text-luxury-orange uppercase">{cliente.nome}</h2>
        <div className="ml-auto flex items-center gap-3 pr-1">
          {cliente.telefone && (
            <button
              ref={whatsappBtnRef}
              onClick={() => abrirWhatsApp(cliente.telefone!)}
              onFocus={() => { setNavZone('header'); setHeaderField('whatsapp'); }}
              className={`flex items-center gap-1.5 text-green-400 hover:text-green-300 transition-colors font-mono text-sm font-bold rounded-lg px-2 py-1 outline-none
                ${navZone === 'header' && headerField === 'whatsapp' ? 'ring-2 ring-green-400/50 bg-green-400/10' : ''}`}
              title="Abrir no WhatsApp"
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>
              {cliente.telefone}
            </button>
          )}
          <button
            ref={imprimirBtnRef}
            onClick={() => setShowModalImpressao(true)}
            onFocus={() => { setNavZone('header'); setHeaderField('imprimir'); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all text-xs font-bold uppercase outline-none
              ${navZone === 'header' && headerField === 'imprimir' ? 'bg-luxury-orange text-white scale-105 shadow-lg shadow-luxury-orange/30' : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white'}`}
          >
            <Printer size={13} /> Imprimir
          </button>
          {saldoGlobal <= 0 && (
            <button
              ref={arquivarBtnRef}
              onClick={() => setShowArquivarConfirm(true)}
              onFocus={() => { setNavZone('header'); setHeaderField('arquivar'); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase transition-all outline-none
                ${navZone === 'header' && headerField === 'arquivar' ? 'bg-green-500 text-white scale-105 shadow-lg shadow-green-500/30' : 'bg-green-500/10 hover:bg-green-500/20 text-green-400 hover:text-green-300'}`}
              title="Conta zerada — arquivar histórico"
            >
              <Archive size={13} /> Arquivar Conta
            </button>
          )}
        </div>
      </div>

      <div className="glass-card px-4 py-2.5 flex items-center gap-2 shrink-0 border-luxury-orange/20 overflow-hidden">
        <div className="shrink-0">
          <p className="text-[10px] text-white/30 uppercase font-bold tracking-widest">Saldo Devedor (Total)</p>
          <p className={`text-xl font-black font-mono whitespace-nowrap ${(resumoGlobal.saldo || 0) > 0 ? 'text-red-400' : 'text-green-400'}`}>
            R$ {fmtBRL(resumoGlobal.saldo || 0)}
          </p>
        </div>
        <div className="h-8 w-px bg-white/5 shrink-0 mx-2"></div>
        <div className="shrink-0">
          <p className="text-[10px] text-white/30 uppercase font-bold">Compras Acum.</p>
          <p className="text-sm font-bold text-white/80 font-mono whitespace-nowrap">R$ {fmtBRL(resumoGlobal.compras || 0)}</p>
        </div>
        <div className="shrink-0">
          <p className="text-[10px] text-white/30 uppercase font-bold">Pago Total</p>
          <p className="text-sm font-bold text-green-400/80 font-mono whitespace-nowrap">R$ {fmtBRL(resumoGlobal.pago || 0)}</p>
        </div>
      </div>

      {/* Filtro de data */}
      <div className="glass-card px-4 py-2 flex gap-3 items-end shrink-0 overflow-hidden">
        <div className="w-40 shrink-0">
          <DateInput label="Data Inicial" value={dataInicial} onChange={setDataInicial}
            externalRef={dataInicialRef}
            highlighted={navZone === 'dates' && dateField === 'inicial'}
            active={navZone === 'dates' && dateField === 'inicial' && inputActive} />
        </div>
        <div className="w-40 shrink-0">
          <DateInput label="Data Final" value={dataFinal} onChange={setDataFinal}
            externalRef={dataFinalRef}
            highlighted={navZone === 'dates' && dateField === 'final'}
            active={navZone === 'dates' && dateField === 'final' && inputActive} />
        </div>
        {/* Resumo Período */}
        <div className="flex gap-3 ml-auto text-right overflow-hidden">
          <div className="shrink-0">
            <p className="text-[10px] text-white/30 uppercase font-bold">Compras (Período)</p>
            <p className="text-base font-black text-white/60 font-mono whitespace-nowrap">R$ {fmtBRL(totalComprasPeriodo || 0)}</p>
          </div>
          <div className="shrink-0">
            <p className="text-[10px] text-white/30 uppercase font-bold">Pago (Período)</p>
            <p className="text-base font-black text-green-400/60 font-mono whitespace-nowrap">R$ {fmtBRL(totalPagoPeriodo || 0)}</p>
          </div>
          <div className="pl-3 border-l border-white/5 shrink-0">
            <p className="text-[10px] text-white/30 uppercase font-bold">Saldo Período</p>
            <p className={`text-base font-black font-mono whitespace-nowrap ${(saldoPeriodo || 0) > 0 ? 'text-red-400/60' : 'text-green-400/60'}`}>R$ {fmtBRL(saldoPeriodo || 0)}</p>
          </div>
        </div>
      </div>

      {/* Aviso conta zerada */}
      {zerouAviso && (
        <div className="glass-card px-4 py-3 border border-green-500/30 bg-green-500/10 flex items-center justify-between shrink-0">
          <p className="text-green-400 font-bold text-sm">Conta do mês zerada! Cliente pagou tudo dentro do período.</p>
          <button onClick={() => setZerouAviso(false)} className="text-white/40 hover:text-white"><X size={16} /></button>
        </div>
      )}

      <div className="flex flex-1 gap-3 overflow-hidden">
        {/* Vendas */}
        <div className="flex-[5] min-w-0 flex flex-col overflow-hidden glass-card">
          <div className="px-4 py-2 border-b border-white/5 flex items-center justify-between">
            <p className="text-xs uppercase tracking-widest text-white/40 font-bold">Compras ({itensFiltrados.length})</p>
            <button
              ref={addItemBtnRef}
              onClick={openNovoItem}
              onFocus={() => { setNavZone('items_header'); }}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg transition-all outline-none
                ${navZone === 'items_header' ? 'bg-luxury-orange text-white ring-2 ring-luxury-orange shadow-lg scale-105' : 'bg-luxury-orange/10 text-luxury-orange hover:bg-luxury-orange hover:text-white'}`}>
              <Plus size={12} /> Item
            </button>

          </div>
          <div className="flex-1 overflow-auto">
            {itensFiltrados.length === 0 && <p className="text-center text-white/30 text-sm py-8">Nenhuma compra no período</p>}
            {itensFiltrados.map((item, idx) => (
              <div
                key={item.id}
                ref={el => { itemRefs.current[idx] = el; }}
                tabIndex={0}
                onFocus={() => { if (itemMenuIdx === null) setFocusedItemIdx(idx); }}
                onBlur={e => {
                  if (itemMenuIdx === null && !e.currentTarget.contains(e.relatedTarget as Node)) {
                    setFocusedItemIdx(null);
                  }
                }}
                className={`relative flex items-center gap-3 px-4 py-2.5 border-b border-white/5 group text-sm transition-colors cursor-pointer outline-none
                  ${(focusedItemIdx === idx || itemMenuIdx === idx) ? 'bg-luxury-orange/10 border-luxury-orange/20' : 'hover:bg-white/5'}`}
              >
                <span className="font-mono text-white/40 w-24 shrink-0">{isoToBr(item.data_venda)}</span>
                <span className="flex-1 text-white font-semibold truncate">{item.produto_nome}</span>
                <span className="text-white/40 w-8 text-right shrink-0">{item.quantidade}x</span>
                <span className="text-luxury-orange font-black w-24 text-right font-mono shrink-0">R$ {fmtBRL(item.valor_total || 0)}</span>
                <div className={`flex gap-2 transition-opacity shrink-0 ${itemMenuIdx === idx ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus:opacity-100'}`}>
                  <button
                    ref={itemMenuIdx === idx && itemMenuFocus === 0 ? itemMenuEditRef : null}
                    onClick={e => { e.stopPropagation(); openEditItem(item); }}
                    className={`p-1.5 rounded-lg border-2 transition-all outline-none
                      ${itemMenuIdx === idx && itemMenuFocus === 0 ? 'bg-luxury-orange/20 border-luxury-orange text-luxury-orange' : 'border-transparent text-white/40 hover:text-white hover:bg-white/10'}`}
                  >
                    <Edit2 size={13} />
                  </button>
                  <button
                    ref={itemMenuIdx === idx && itemMenuFocus === 1 ? itemMenuDeleteRef : null}
                    onClick={e => { e.stopPropagation(); setDeleteItem(item); }}
                    className={`p-1.5 rounded-lg border-2 transition-all outline-none
                      ${itemMenuIdx === idx && itemMenuFocus === 1 ? 'bg-red-500/20 border-red-500 text-red-500' : 'border-transparent text-white/40 hover:text-red-500 hover:bg-red-500/10'}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Pagamentos */}
        <div className="flex-[4] min-w-0 flex flex-col glass-card overflow-hidden border-luxury-orange/10">
          <div className="px-4 py-2 border-b border-white/5 flex items-center justify-between bg-black/20">
            <p className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Histórico de Pagamentos</p>
            <button
              ref={togglePagFormBtnRef}
              onClick={() => {
                if (!showPagForm) {
                  setNovoPagForm({ data: getTodayStr(), valor: '', observacao: '' });
                  setPagError(null);
                }
                setShowPagForm(!showPagForm);
              }}
              onFocus={() => { setNavZone('pag'); setPagField('header'); }}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase transition-all outline-none shadow-sm
                ${(navZone === 'pag' && pagField === 'header') 
                  ? 'bg-green-500 text-white scale-110 shadow-[0_0_15px_rgba(34,197,94,0.5)] ring-2 ring-green-400' 
                  : showPagForm 
                    ? 'bg-red-500/20 text-red-500 hover:bg-red-500/30' 
                    : 'bg-green-500/20 text-green-400 hover:bg-green-500/30 hover:scale-110 hover:shadow-[0_0_15px_rgba(34,197,94,0.3)] active:scale-95'}`}
            >
              {showPagForm ? <X size={10} /> : <Plus size={10} />}
              {showPagForm ? 'Fechar' : 'Novo'}
            </button>
          </div>

          {/* Form novo pagamento (Collapsible) */}
          {showPagForm && (
            <form onSubmit={salvarPagamento} className="p-3 border-b border-white/10 bg-luxury-orange/5 space-y-2 animate-in slide-in-from-top duration-200">
              <div className="flex gap-2 items-end">
                <div className="flex-[11] min-w-0">
                  <DateInput label="Data" value={novoPagForm.data} onChange={v => setNovoPagForm({...novoPagForm, data: v})}
                    externalRef={pagDataRef}
                    highlighted={navZone === 'pag' && pagField === 'data'} />
                </div>
                <div className="flex-[9] min-w-0">
                  <label className="block text-[10px] uppercase text-white/40 font-bold mb-0.5">Valor</label>
                  <input ref={pagValorRef} type="text"
                    tabIndex={-1}
                    className={`luxury-input w-full h-10 font-mono text-center text-base ${navZone === 'pag' && pagField === 'valor' ? 'border-luxury-orange ring-1' : ''}`}
                    placeholder="0,00"
                    value={novoPagForm.valor}
                    onFocus={() => setPagField('valor')}
                    onChange={e => {
                      setPagError(null);
                      const formatted = handleCurrencyInput(e.target.value);
                      if (parseCurrencyToNumber(formatted) <= 99999.99) setNovoPagForm({...novoPagForm, valor: formatted});
                    }} />
                </div>
              </div>
              <input ref={pagObsRef} type="text" maxLength={60} placeholder="Observação (opcional)"
                tabIndex={-1}
                className={`luxury-input w-full h-10 text-sm ${navZone === 'pag' && pagField === 'obs' ? 'border-luxury-orange ring-1' : ''}`}
                value={novoPagForm.observacao}
                onFocus={() => setPagField('obs')}
                onChange={e => setNovoPagForm({...novoPagForm, observacao: e.target.value})} />

              {pagError && <p className="text-red-400 text-[10px]">{pagError}</p>}

              <button ref={registrarBtnRef} type="submit" tabIndex={-1}
                onFocus={() => setPagField('registrar')}
                className={`btn-primary w-full h-10 text-xs font-bold uppercase flex items-center justify-center gap-1 outline-none
                  ${navZone === 'pag' && pagField === 'registrar' ? 'ring-2 ring-luxury-orange/60' : ''}`}>
                Confirmar Pagamento
              </button>
            </form>
          )}

          {/* Lista pagamentos - ULTRA COMPACTA */}
          <div className="flex-1 overflow-auto">
            {pagamentosFiltrados.length === 0 && <p className="text-center text-white/30 text-[10px] py-8 uppercase tracking-widest">Vazio</p>}
            {pagamentosFiltrados.map((p, pidx) => (
              <div
                key={p.id}
                ref={el => { pagRowRefs.current[pidx] = el; }}
                tabIndex={0}
                onFocus={() => { if (navZone === 'pag' && pagMenuIdx === null) setFocusedPagIdx(pidx); }}
                className={`flex items-center gap-2 px-3 py-1.5 border-b border-white/5 group text-xs outline-none transition-colors cursor-pointer
                  ${(navZone === 'pag' && pagField === 'lista' && focusedPagIdx === pidx) || pagMenuIdx === pidx ? 'bg-luxury-orange/10' : 'hover:bg-white/5'}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-white/40 text-[11px] font-bold">{isoToBr(p.data_pagamento)}</span>
                    <span className="text-green-400 font-black text-sm">R$ {fmtBRL(p.valor || 0)}</span>
                  </div>
                  {p.observacao && <p className="text-white/40 text-[10px] truncate leading-tight">{p.observacao}</p>}
                </div>
                <div className={`flex gap-1 transition-opacity ${pagMenuIdx === pidx ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                  <button
                    ref={pagMenuIdx === pidx && pagMenuFocus === 0 ? pagMenuEditRef : null}
                    onClick={e => { e.stopPropagation(); openEditPag(p, pidx); }}
                    className={`p-1 rounded transition-all outline-none
                      ${pagMenuIdx === pidx && pagMenuFocus === 0 ? 'bg-luxury-orange/20 text-luxury-orange' : 'text-white/20 hover:text-white'}`}
                  >
                    <Edit2 size={10} />
                  </button>
                  <button
                    ref={pagMenuIdx === pidx && pagMenuFocus === 1 ? pagMenuDeleteRef : null}
                    onClick={e => { e.stopPropagation(); setDeletePag(p); }}
                    className={`p-1 rounded transition-all outline-none
                      ${pagMenuIdx === pidx && pagMenuFocus === 1 ? 'bg-red-500/20 text-red-500' : 'text-white/20 hover:text-red-500'}`}
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>



      {/* Popup contextual pagamento — portal centralizado */}


      {/* Modal editar item */}
      {editItem && (
        <ModalOverlay onClose={closeEditItem}>
          <div 
            className="glass-card w-[500px] p-8 border-luxury-orange/20 outline-none" 
            tabIndex={0}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Escape') { e.preventDefault(); closeEditItem(); }
              
              // Navegação entre botões se estivermos na zona de botões
              if (eiField === 'btns') {
                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                  e.preventDefault();
                  const next = eiBtnFocus === 0 ? 1 : 0;
                  setEiBtnFocus(next);
                  if (next === 0) eiCancelarBtnRef.current?.focus();
                  else eiSalvarBtnRef.current?.focus();
                }
              }
            }}
          >
            <div className="flex justify-between items-start mb-8">
              <h3 className="text-2xl font-black italic text-luxury-orange uppercase tracking-tighter leading-none">Editar Item</h3>
              <button type="button" onClick={closeEditItem} className="text-white/20 hover:text-white transition-colors"><X size={20} /></button>
            </div>
            
            {itemError && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-xl text-xs font-bold mb-6 flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-red-400 rounded-full animate-pulse" />
                {itemError}
              </div>
            )}
            
            <form onSubmit={saveEditItem} className="space-y-6" onKeyDown={e => { if (e.key === 'Enter' && !['button', 'submit'].includes((e.target as any).type)) e.preventDefault(); }}>
              <div className="relative">
                <label className="block text-[10px] uppercase tracking-[0.2em] text-white/30 font-bold mb-2">Nome do Produto</label>
                <input
                  ref={eiProdutoRef}
                  type="text"
                  maxLength={40}
                  className={`luxury-input w-full h-12 text-sm transition-all
                    ${getHighlight(eiField === 'produto')}`}
                  onFocus={() => setEiField('produto')}
                  value={eiProdutoSearch}
                  onChange={async e => {
                    const val = e.target.value.toUpperCase();
                    setEiProdutoSearch(val);
                    setEiProdutoSelecionado(null);
                    setEiProdutoResultsIdx(-1);
                    setEditItemForm(f => ({...f, produto_nome: val}));
                    setItemError(null);
                    if (val.length < 1) { setEiProdutoResults([]); return; }
                    const rows: any[] = await db.select(
                      "SELECT id, nome, preco_venda FROM produtos WHERE ativo=1 AND (nome LIKE $1 OR codigo_barras = $2) LIMIT 5",
                      [`%${val}%`, val]
                    );
                    setEiProdutoResults(rows);
                  }} />
                {eiProdutoResults.length > 0 && !eiProdutoSelecionado && (
                  <div className="absolute top-full left-0 right-0 z-20 mt-2 bg-luxury-dark-gray border border-white/10 rounded-xl overflow-hidden shadow-2xl backdrop-blur-xl">
                    {eiProdutoResults.map((p, pidx) => (
                      <button
                        key={p.id}
                        type="button"
                        className={`w-full text-left px-4 py-3.5 flex items-center justify-between text-sm transition-all
                          ${eiProdutoResultsIdx === pidx ? 'bg-luxury-orange text-white' : 'hover:bg-white/5 text-white/50'}`}
                        onClick={() => {
                          const qty = parseInt(editItemForm.quantidade) || 1;
                          const total = (p.preco_venda * qty).toFixed(2).replace('.', ',');
                          setEiProdutoSelecionado(p);
                          setEiProdutoSearch(p.nome);
                          setEiProdutoResults([]);
                          setEiProdutoResultsIdx(-1);
                          setEditItemForm(f => ({...f, produto_nome: p.nome, valor_total: total}));
                          setEiField('quantidade');
                        }}
                      >
                        <span className="font-bold uppercase tracking-tight">{p.nome}</span>
                        <span className={`${eiProdutoResultsIdx === pidx ? 'text-white/80' : 'text-luxury-orange'} font-mono text-xs ml-2 bg-black/40 px-2 py-0.5 rounded`}>R$ {fmtBRL(p.preco_venda)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase tracking-[0.2em] text-white/30 font-bold mb-2">Quantidade</label>
                  <input
                    ref={eiQuantidadeRef}
                    type="text"
                    className={`luxury-input w-full h-12 text-sm transition-all
                      ${getHighlight(eiField === 'quantidade')}`}
                    onFocus={() => setEiField('quantidade')}
                    value={editItemForm.quantidade}
                    onChange={e => setEditItemForm({...editItemForm, quantidade: e.target.value.replace(/\D/g, '')})} />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-[0.2em] text-white/30 font-bold mb-2">Valor Total (R$)</label>
                  <input
                    ref={eiValorRef}
                    type="text"
                    className={`luxury-input w-full h-12 font-mono text-sm transition-all
                      ${getHighlight(eiField === 'valor')}`}
                    onFocus={() => setEiField('valor')}
                    value={editItemForm.valor_total}
                    onChange={e => {
                      const formatted = handleCurrencyInput(e.target.value);
                      if (parseCurrencyToNumber(formatted) <= 99999.99) setEditItemForm({...editItemForm, valor_total: formatted});
                    }} />
                </div>
              </div>

              <div className="flex gap-4 pt-6 border-t border-white/5">
                <button
                  ref={eiCancelarBtnRef}
                  type="button"
                  onClick={closeEditItem}
                  onFocus={() => { setEiField('btns'); setEiBtnFocus(0); }}
                  className={`flex-1 h-12 rounded-xl uppercase text-[10px] font-bold tracking-[0.1em] transition-all outline-none border
                    ${eiField === 'btns' && eiBtnFocus === 0 
                      ? 'bg-red-600 border-transparent text-white ring-2 ring-white/50 shadow-lg shadow-red-600/20 scale-[1.02]' 
                      : 'bg-red-600/10 border-red-500/10 text-red-400 hover:bg-red-600/20'}`}
                >
                  Cancelar (ESC)
                </button>
                <button
                  ref={eiSalvarBtnRef}
                  type="submit"
                  onFocus={() => { setEiField('btns'); setEiBtnFocus(1); }}
                  className={`flex-1 h-12 rounded-xl uppercase text-[10px] font-bold tracking-[0.1em] transition-all outline-none shadow-lg
                    ${eiField === 'btns' && eiBtnFocus === 1 
                      ? 'bg-luxury-orange text-white ring-2 ring-white/50 shadow-luxury-orange/30 scale-[1.02]' 
                      : 'bg-luxury-orange text-white opacity-90'}`}
                >
                  Gravar Alteração
                </button>
              </div>
            </form>
          </div>
        </ModalOverlay>
      )}

      {deleteItem && <ConfirmModal msg="Excluir item?" item={`${deleteItem.produto_nome} — R$ ${fmtBRL(deleteItem.valor_total)}`} onConfirm={handleDeleteItem} onCancel={() => setDeleteItem(null)} />}
      {deletePag && <ConfirmModal msg="Excluir pagamento?" item={`${isoToBr(deletePag.data_pagamento)} — R$ ${fmtBRL(deletePag.valor)}`} onConfirm={handleDeletePag} onCancel={() => setDeletePag(null)} />}

      {/* Modal editar pagamento */}
      {editPag && (
        <ModalOverlay onClose={closeEditPag} zIndex={300}>
          <div className="glass-card w-[500px] p-8 border-luxury-orange/20 shadow-2xl relative">
            <div className="flex justify-between items-start mb-8">
              <h3 className="text-2xl font-black italic text-luxury-orange uppercase tracking-tighter leading-none">Editar Pagamento</h3>
              <button onClick={closeEditPag} className="text-white/20 hover:text-white transition-colors"><X size={20} /></button>
            </div>
            <form onSubmit={saveEditPag} className="space-y-6" onKeyDown={e => { if (e.key === 'Enter' && !['button', 'submit'].includes((e.target as any).type)) e.preventDefault(); }}>
              <DateInput
                label="Data do Pagamento"
                value={editPagForm.data}
                onChange={v => setEditPagForm({...editPagForm, data: v})}
                externalRef={editPagDataRef}
                highlighted={modalNavZone === 'edit_pag' && modalNavField === 'data'}
              />
              <div>
                <label className="block text-[10px] uppercase tracking-[0.2em] text-white/30 font-bold mb-2">Valor do Pagamento (R$)</label>
                <input
                  ref={editPagValorRef}
                  type="text"
                  className={`luxury-input w-full h-12 font-mono text-center text-lg transition-all
                    ${getHighlight(modalNavZone === 'edit_pag' && modalNavField === 'valor')}`}
                  value={editPagForm.valor}
                  onFocus={() => { setModalNavZone('edit_pag'); setModalNavField('valor'); }}
                  onChange={e => setEditPagForm({...editPagForm, valor: handleCurrencyInput(e.target.value)})}
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-[0.2em] text-white/30 font-bold mb-2">Observação (Opcional)</label>
                <input
                  ref={editPagObsRef}
                  type="text"
                  maxLength={60}
                  className={`luxury-input w-full h-12 text-sm transition-all
                    ${getHighlight(modalNavZone === 'edit_pag' && modalNavField === 'obs')}`}
                  value={editPagForm.observacao}
                  onFocus={() => { setModalNavZone('edit_pag'); setModalNavField('obs'); }}
                  onChange={e => setEditPagForm({...editPagForm, observacao: e.target.value})}
                />
              </div>
              <div className="flex gap-4 pt-4 border-t border-white/5">
                <button
                  ref={editPagCancelBtnRef}
                  type="button"
                  onClick={closeEditPag}
                  onFocus={() => { setModalNavZone('edit_pag'); setModalNavField('cancelar'); }}
                  style={{ fontWeight: 700 }}
                  className={`flex-1 h-14 rounded-xl border transition-all uppercase text-sm font-bold tracking-[0.05em]
                    ${modalNavZone === 'edit_pag' && modalNavField === 'cancelar' ? 'bg-white/10 border-white/20 text-white' : 'border-white/5 text-white/20 hover:bg-white/5'}`}
                >
                  Cancelar
                </button>
                <button
                  ref={editPagSaveBtnRef}
                  type="submit"
                  onFocus={() => { setModalNavZone('edit_pag'); setModalNavField('salvar'); }}
                  style={{ fontWeight: 700 }}
                  className={`flex-1 h-14 rounded-xl transition-all uppercase text-sm font-bold tracking-[0.05em] shadow-lg
                    ${modalNavZone === 'edit_pag' && modalNavField === 'salvar' ? 'bg-luxury-orange text-white scale-[1.02] shadow-luxury-orange/20' : 'bg-luxury-orange text-white'}`}
                >
                  Gravar Pagamento
                </button>
              </div>
            </form>
          </div>
        </ModalOverlay>
      )}

      {/* Confirmar arquivar */}
      {showArquivarConfirm && (
        <ModalOverlay onClose={() => setShowArquivarConfirm(false)} zIndex={300}>
          <div
            className="bg-luxury-gray rounded-3xl p-8 w-[440px] border border-white/10 shadow-2xl relative"
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'ArrowDown') { e.preventDefault(); setArquivarSelected('cancelar'); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setArquivarSelected('sim'); }
              else if (e.key === 'Enter') { e.preventDefault(); if (arquivarSelected === 'sim') arquivarSimRef.current?.click(); else arquivarCancelRef.current?.click(); }
            }}
          >
            <h3 className="text-xl font-black italic text-green-400 uppercase tracking-tighter mb-2">Arquivar Conta?</h3>
            <p className="text-white/70 text-sm mb-2">
              Isso vai mover todo o histórico de <span className="text-white font-bold">{cliente.nome}</span> para o arquivo.
            </p>
            <p className="text-white/40 text-xs mb-6">Compras e pagamentos serão apagados do registro ativo. O cliente permanece cadastrado.</p>
            <div className="space-y-2">
              <button ref={arquivarSimRef} onClick={handleArquivar} className={`w-full h-12 rounded-xl text-white font-medium uppercase tracking-widest text-sm transition-all flex items-center justify-center gap-2 outline-none ${arquivarSelected === 'sim' ? 'bg-green-600 ring-2 ring-white/40' : 'bg-green-600/50 hover:bg-green-600'}`}>
                <Archive size={16} /> Sim, arquivar
              </button>
              <button ref={arquivarCancelRef} onClick={() => setShowArquivarConfirm(false)} className={`w-full h-12 rounded-xl border font-medium uppercase text-xs transition-all outline-none ${arquivarSelected === 'cancelar' ? 'border-white/40 bg-white/10 ring-2 ring-white/20 text-white' : 'border-white/10 hover:bg-white/5 text-white/60 hover:text-white'}`}>
                Cancelar
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {showNovoItem && (
        <ModalOverlay onClose={() => { setShowNovoItem(false); setModalNavZone(null); setNavZone('items'); }}>
          <div className="glass-card w-[660px] p-8 border-luxury-orange/20 shadow-2xl" onKeyDown={e => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-8">
              <h3 className="text-2xl font-black italic text-luxury-orange uppercase tracking-tighter leading-none">Novo Item</h3>
              <button onClick={() => { setShowNovoItem(false); setModalNavZone(null); setNavZone('items'); }} className="text-white/20 hover:text-white transition-colors"><X size={20} /></button>
            </div>
            <form onSubmit={salvarNovoItem} className="space-y-6">
              <DateInput
                label="Data da Venda"
                value={novoItemForm.data}
                onChange={v => setNovoItemForm({...novoItemForm, data: v})}
                externalRef={niDataRef}
                highlighted={modalNavZone === 'novo_item' && modalNavField === 'data'}
              />
              <div className="relative">
                <label className="block text-[10px] uppercase tracking-[0.2em] text-white/30 font-bold mb-2">Nome do Produto</label>
                <div className="relative">
                  <input
                    ref={niProdutoRef}
                    type="text"
                    maxLength={40}
                    placeholder="BUSCAR PRODUTO CADASTRADO..."
                    className={`luxury-input w-full h-12 text-sm transition-all
                      ${getHighlight(modalNavZone === 'novo_item' && modalNavField === 'produto')}`}
                    value={produtoSearch}
                    onFocus={() => { setModalNavZone('novo_item'); setModalNavField('produto'); }}
                    onChange={async e => {
                      const val = e.target.value.toUpperCase();
                      setProdutoSearch(val);
                      setProdutoSelecionado(null);
                      setProdutoResultsIdx(-1);
                      setNovoItemForm(f => ({...f, produto_nome: val}));
                      setNovoItemError(null);
                      if (val.length < 1) { setProdutoResults([]); return; }
                      const rows: any[] = await db.select(
                        "SELECT id, nome, preco_venda FROM produtos WHERE ativo=1 AND (nome LIKE $1 OR codigo_barras = $2) LIMIT 5",
                        [`%${val}%`, val]
                      );
                      setProdutoResults(rows);
                    }}
                  />
                  {produtoResults.length > 0 && !produtoSelecionado && (
                    <div className="absolute top-full left-0 right-0 z-20 mt-2 bg-luxury-dark-gray border border-white/10 rounded-xl overflow-hidden shadow-2xl backdrop-blur-xl">
                      {produtoResults.map((p, pidx) => (
                        <button
                          key={p.id}
                          type="button"
                          className={`w-full text-left px-4 py-3.5 flex items-center justify-between text-sm transition-all
                            ${produtoResultsIdx === pidx ? 'bg-luxury-orange text-white' : 'hover:bg-white/5 text-white/50'}`}
                          onClick={() => {
                            const qty = parseFloat(novoItemForm.quantidade.replace(',', '.')) || 1;
                            const total = (p.preco_venda * qty).toFixed(2).replace('.', ',');
                            setProdutoSelecionado(p);
                            setProdutoSearch(p.nome);
                            setProdutoResults([]);
                            setProdutoResultsIdx(-1);
                            setNovoItemForm(f => ({...f, produto_nome: p.nome, valor_total: total}));
                            setModalNavField('quantidade');
                          }}
                        >
                          <span className="font-bold uppercase tracking-tight truncate">{p.nome}</span>
                          <span className={`${produtoResultsIdx === pidx ? 'text-white/80' : 'text-luxury-orange'} font-mono text-xs ml-4 shrink-0 bg-black/40 px-2 py-0.5 rounded`}>R$ {fmtBRL(p.preco_venda)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase tracking-[0.2em] text-white/30 font-bold mb-2">Quantidade</label>
                  <input
                    ref={niQtyRef}
                    type="text"
                    className={`luxury-input w-full h-12 text-sm transition-all
                      ${getHighlight(modalNavZone === 'novo_item' && modalNavField === 'quantidade')}`}
                    onFocus={e => { setModalNavZone('novo_item'); setModalNavField('quantidade'); e.currentTarget.select(); }}
                    value={novoItemForm.quantidade}
                    onKeyDown={e => {
                      const input = e.currentTarget;
                      const val = input.value;
                      const pos = input.selectionStart ?? 0;
                      const dotIndex = val.indexOf('.');
                      const selStart = input.selectionStart ?? 0;
                      const selEnd = input.selectionEnd ?? 0;
                      const allSelected = selStart === 0 && selEnd === val.length && val.length > 0;

                      if (/^\d$/.test(e.key)) {
                        e.preventDefault();
                        if (allSelected) {
                          const newVal = e.key + '.000';
                          setNovoItemForm(f => {
                            const qty = parseFloat(newVal) || 0;
                            const total = produtoSelecionado ? (produtoSelecionado.preco_venda * qty).toFixed(2).replace('.', ',') : f.valor_total;
                            return {...f, quantidade: newVal, valor_total: total};
                          });
                          setTimeout(() => input.setSelectionRange(1, 1), 0);
                          return;
                        }
                        if (dotIndex !== -1 && pos > dotIndex) {
                          if (pos >= val.length) return;
                          const newVal = val.substring(0, pos) + e.key + val.substring(pos + 1);
                          setNovoItemForm(f => {
                            const qty = parseFloat(newVal) || 0;
                            const total = produtoSelecionado ? (produtoSelecionado.preco_venda * qty).toFixed(2).replace('.', ',') : f.valor_total;
                            return {...f, quantidade: newVal, valor_total: total};
                          });
                          setTimeout(() => input.setSelectionRange(pos + 1, pos + 1), 0);
                        } else if (pos === dotIndex) {
                          const intPart = val.substring(0, dotIndex);
                          if (intPart.length >= 5) return;
                          const newVal = intPart + e.key + val.substring(dotIndex);
                          setNovoItemForm(f => {
                            const qty = parseFloat(newVal) || 0;
                            const total = produtoSelecionado ? (produtoSelecionado.preco_venda * qty).toFixed(2).replace('.', ',') : f.valor_total;
                            return {...f, quantidade: newVal, valor_total: total};
                          });
                          setTimeout(() => input.setSelectionRange(pos + 1, pos + 1), 0);
                        } else {
                          const intPart = dotIndex === -1 ? val : val.substring(0, dotIndex);
                          if (intPart.length >= 5 && pos <= (dotIndex === -1 ? val.length : dotIndex) && selStart === selEnd) return;
                        }
                      } else if (e.key === '.' || e.key === ',') {
                        e.preventDefault();
                        if (allSelected) {
                          const newVal = '0.000';
                          setNovoItemForm(f => ({...f, quantidade: newVal}));
                          setTimeout(() => input.setSelectionRange(2, 2), 0);
                        } else if (dotIndex === -1) {
                          const prefix = val || '0';
                          const newVal = prefix + '.000';
                          setNovoItemForm(f => ({...f, quantidade: newVal}));
                          setTimeout(() => input.setSelectionRange(prefix.length + 1, prefix.length + 1), 0);
                        } else {
                          input.setSelectionRange(dotIndex + 1, dotIndex + 1);
                        }
                      }
                    }}
                    onChange={() => {}} />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-[0.2em] text-white/30 font-bold mb-2">Valor Total (R$)</label>
                  <input
                    ref={niValorRef}
                    type="text"
                    className={`luxury-input w-full h-12 font-mono text-center text-sm transition-all
                      ${getHighlight(modalNavZone === 'novo_item' && modalNavField === 'valor')}`}
                    onFocus={() => { setModalNavZone('novo_item'); setModalNavField('valor'); }}
                    value={novoItemForm.valor_total}
                    onChange={e => {
                      const formatted = handleCurrencyInput(e.target.value);
                      if (parseCurrencyToNumber(formatted) <= 99999.99) setNovoItemForm(f => ({...f, valor_total: formatted}));
                    }} />
                </div>
              </div>

              {novoItemError && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-xl text-xs font-bold flex items-center gap-2">
                  <div className="w-1.5 h-1.5 bg-red-400 rounded-full animate-pulse" />
                  {novoItemError}
                </div>
              )}

              <div className="flex gap-4 pt-4 border-t border-white/5">
                <button
                  ref={niCancelRef}
                  type="button"
                  onClick={() => { setShowNovoItem(false); setModalNavZone(null); setNavZone('items'); }}
                  onFocus={() => { setModalNavZone('novo_item'); setModalNavField('cancelar'); }}
                  style={{ fontWeight: 700 }}
                  className={`flex-1 h-14 rounded-xl border transition-all uppercase text-sm font-bold tracking-[0.05em] outline-none
                    ${modalNavZone === 'novo_item' && modalNavField === 'cancelar' ? 'bg-white/10 border-white/20 text-white' : 'border-white/5 text-white/20 hover:bg-white/5'}`}
                >
                  Cancelar
                </button>
                <button
                  ref={niSaveRef}
                  type="submit"
                  onFocus={() => { setModalNavZone('novo_item'); setModalNavField('salvar'); }}
                  style={{ fontWeight: 900 }}
                  className={`flex-1 h-12 rounded-xl uppercase text-sm font-black tracking-[0.05em] transition-all outline-none shadow-lg
                    ${modalNavZone === 'novo_item' && modalNavField === 'salvar' ? 'bg-luxury-orange text-white scale-[1.02] shadow-luxury-orange/20' : 'bg-luxury-orange text-white'}`}
                >
                  Lançar
                </button>
              </div>
            </form>
          </div>
        </ModalOverlay>
      )}

      {showModalImpressao && (
        <ModalImpressao
          opts={{ nomeLoja, cliente, itens, pagamentos, dataInicial, dataFinal }}
          onClose={() => setShowModalImpressao(false)}
        />
      )}
    </div>
  );
}

type TelaSaldoGeralProps = {
  db: any;
  onVerConta: (c: Cliente) => void;
};

function TelaSaldoGeral({ db, onVerConta }: TelaSaldoGeralProps) {
  const [saldos, setSaldos] = useState<SaldoCliente[]>([]);
  const [dataInicial, setDataInicial] = useState('01/01/2000');
  const [dataFinal, setDataFinal] = useState(getTodayStr());

  // Navegação
  const [navZone, setNavZone] = useState<'filters' | 'list'>('filters');
  const [dateField, setDateField] = useState<'inicial' | 'final'>('inicial');
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);
  const [inputActive, setInputActive] = useState(false);
  const [clientBtnFocus, setClientBtnFocus] = useState(false);

  const dataInicialRef = useRef<HTMLInputElement>(null);
  const dataFinalRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const viewBtnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    // Foco inicial
    if (navZone === 'filters') {
      const ref = dateField === 'inicial' ? dataInicialRef : dataFinalRef;
      focusAtStart(ref);
    }
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (inputActive) {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault(); setInputActive(false);
          (document.activeElement as HTMLElement)?.blur();
        }
        return;
      }

      if (navZone === 'filters') {
        if (e.key === 'ArrowRight') { e.preventDefault(); setDateField('final'); focusAtStart(dataFinalRef); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); setDateField('inicial'); focusAtStart(dataInicialRef); }
        else if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (saldos.length > 0) {
            setNavZone('list'); setFocusedIdx(0);
            setTimeout(() => rowRefs.current[0]?.focus(), 10);
          }
        } else if (e.key === 'Enter') {
          e.preventDefault(); setInputActive(true);
        } else if (e.key === 'Escape') {
          // Volta foco para o header pai (fictício ou via callback se precisar)
        }
      } else if (navZone === 'list') {
        if (focusedIdx !== null) {
          if (clientBtnFocus) {
            if (e.key === 'Enter') { e.preventDefault(); viewBtnRefs.current[focusedIdx]?.click(); }
            else if (e.key === 'Escape') { e.preventDefault(); setClientBtnFocus(false); setTimeout(() => rowRefs.current[focusedIdx]?.focus(), 10); }
          } else {
            if (e.key === 'ArrowDown' && focusedIdx < saldos.length - 1) {
              e.preventDefault(); setFocusedIdx(focusedIdx + 1);
              setTimeout(() => rowRefs.current[focusedIdx + 1]?.focus(), 10);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              if (focusedIdx > 0) {
                setFocusedIdx(focusedIdx - 1);
                setTimeout(() => rowRefs.current[focusedIdx - 1]?.focus(), 10);
              } else {
                setNavZone('filters'); setFocusedIdx(null);
                focusAtStart(dateField === 'inicial' ? dataInicialRef : dataFinalRef);
              }
            } else if (e.key === 'Enter') {
              e.preventDefault(); setClientBtnFocus(true);
              setTimeout(() => viewBtnRefs.current[focusedIdx]?.focus(), 10);
            } else if (e.key === 'Escape') {
               e.preventDefault();
               setNavZone('filters'); setFocusedIdx(null);
               focusAtStart(dateField === 'inicial' ? dataInicialRef : dataFinalRef);
            }
          }
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navZone, focusedIdx, dateField, inputActive, clientBtnFocus, saldos]);

  const load = async () => {
    if (!db) return;
    const isoInicial = brToIso(dataInicial);
    const isoFinal = brToIso(dataFinal);
    if (!isoInicial || !isoFinal) return;

    const clientes: Cliente[] = (await db.select("SELECT * FROM clientes ORDER BY nome")) || [];
    const result: SaldoCliente[] = [];

    for (const c of clientes) {
      const compras: any[] = await db.select(
        "SELECT COALESCE(SUM(total),0) as total FROM vendas_prazo WHERE cliente_id=$1 AND data_venda>=$2 AND data_venda<=$3",
        [c.id, isoInicial, isoFinal]
      );
      const pagos: any[] = await db.select(
        "SELECT COALESCE(SUM(valor),0) as total FROM pagamentos_prazo WHERE cliente_id=$1 AND data_pagamento>=$2 AND data_pagamento<=$3",
        [c.id, isoInicial, isoFinal]
      );
      const tc = compras[0]?.total || 0;
      const tp = pagos[0]?.total || 0;
      result.push({ id: c.id, nome: c.nome, telefone: c.telefone, total_compras: tc, total_pago: tp, saldo: tc - tp });
    }

    setSaldos(result);
  };

  useEffect(() => { load(); }, [db, dataInicial, dataFinal]);

  const totalGeral = saldos.reduce((a, s) => a + s.saldo, 0);
  // const comSaldo = saldos.filter(s => s.saldo > 0);

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Filtro */}
      <div className="glass-card px-4 py-3 flex gap-4 items-end">
        <div className="w-44">
          <DateInput label="Data Inicial" value={dataInicial} onChange={setDataInicial}
            externalRef={dataInicialRef}
            highlighted={navZone === 'filters' && dateField === 'inicial'} />
        </div>
        <div className="w-44">
          <DateInput label="Data Final" value={dataFinal} onChange={setDataFinal}
            externalRef={dataFinalRef}
            highlighted={navZone === 'filters' && dateField === 'final'} />
        </div>
        <div className="ml-auto text-right">
          <p className="text-xs text-white/30 uppercase font-bold">Total em Aberto</p>
          <p className={`text-2xl font-black ${totalGeral > 0 ? 'text-red-400' : 'text-green-400'}`}>R$ {fmtBRL(totalGeral)}</p>
        </div>
      </div>

      <div className="flex-1 overflow-auto glass-card">
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-luxury-dark-gray/90 backdrop-blur-sm">
            <tr className="border-b border-white/5 text-xs uppercase tracking-widest text-white/40">
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3 text-right">Compras</th>
              <th className="px-4 py-3 text-right">Pago</th>
              <th className="px-4 py-3 text-right">Saldo</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {saldos.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-white/30 text-sm">Nenhum cliente</td></tr>
            )}
            {saldos.map((s, idx) => (
              <tr key={s.id}
                ref={el => { rowRefs.current[idx] = el; }}
                tabIndex={0}
                className={`border-b border-white/5 transition-colors outline-none
                  ${focusedIdx === idx ? 'bg-white/10' : 'hover:bg-white/5 opacity-80'}
                  ${s.saldo > 0 ? '' : 'opacity-40'}`}
              >
                <td className="px-4 py-3 font-semibold text-white">{s.nome}</td>
                <td className="px-4 py-3 text-right text-white/60 font-mono text-sm">R$ {fmtBRL(s.total_compras)}</td>
                <td className="px-4 py-3 text-right text-green-400 font-mono text-sm">R$ {fmtBRL(s.total_pago)}</td>
                <td className={`px-4 py-3 text-right font-black font-mono ${s.saldo > 0 ? 'text-red-400' : 'text-green-400'}`}>
                  R$ {fmtBRL(s.saldo)}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    ref={el => { viewBtnRefs.current[idx] = el; }}
                    onClick={() => onVerConta({ id: s.id, nome: s.nome, telefone: s.telefone, observacao: null, criado_em: '' })}
                    className={`px-3 py-1 rounded-lg text-xs font-bold uppercase transition-all outline-none border-2
                      ${focusedIdx === idx && clientBtnFocus
                        ? 'bg-luxury-orange border-luxury-orange text-white shadow-lg scale-105'
                        : 'bg-luxury-orange/10 border-transparent text-luxury-orange hover:bg-luxury-orange hover:text-white'}`}
                  >
                    Ver Conta
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// IMPRESSÃO
// ══════════════════════════════════════════════════════════════════════
interface OptsImpressao {
  nomeLoja: string;
  cliente: { id?: number; nome: string; telefone?: string | null };
  itens: ItemLinha[];
  pagamentos: Pagamento[];
  dataInicial?: string;
  dataFinal?: string;
}

function formatarTelefone(tel: string): string {
  const n = tel.replace(/\D/g, '');
  if (n.length === 11) return `(${n.slice(0,2)}) ${n[2]} ${n.slice(3,7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0,2)}) ${n.slice(2,6)}-${n.slice(6)}`;
  return tel;
}

function gerarTxt(opts: OptsImpressao): string {
  const { nomeLoja, cliente, itens, pagamentos, dataInicial, dataFinal } = opts;
  const totalCompras = itens.reduce((a, i) => a + i.valor_total, 0);
  const totalPago = pagamentos.reduce((a, p) => a + p.valor, 0);
  const saldo = totalCompras - totalPago;

  // Largura: DATA(10) + 2 + PRODUTO(40) + 2 + QTD(4) + 2 + TOTAL(~9) = 69
  const W = 69;
  const sep = '─'.repeat(W);
  const centro = (s: string) => {
    const pad = Math.max(0, Math.floor((W - s.length) / 2));
    return ' '.repeat(pad) + s;
  };

  const idCliente = cliente.id ? `${cliente.id} - ` : '';
  const telCliente = cliente.telefone ? formatarTelefone(cliente.telefone) : null;
  const periodo = dataInicial && dataFinal ? `Período: ${dataInicial} até ${dataFinal}` : `Emitido em: ${getTodayStr()}`;

  // Cabeçalho de itens alinhado
  const hData    = 'DATA      ';        // 10
  const hProd    = 'PRODUTO'.padEnd(40); // 40
  const hQtd     = ' QTD';              // 4
  const hTotal   = '    TOTAL';         // 9
  const headerItens = `${hData}  ${hProd}  ${hQtd}  ${hTotal}`;

  const linhasItens = itens.length === 0
    ? ['  Nenhuma compra no período']
    : itens.map(i => {
        const data  = isoToBr(i.data_venda);                 // 10
        const prod  = i.produto_nome.padEnd(40).slice(0, 40); // 40
        const qtd   = `${i.quantidade}x`.padStart(4);         // 4
        const total = `R$ ${fmtBRL(i.valor_total)}`.padStart(9); // 9
        return `${data}  ${prod}  ${qtd}  ${total}`;
      });

  const linhasPags = pagamentos.length === 0
    ? ['  Nenhum pagamento']
    : pagamentos.map(p => {
        const data  = isoToBr(p.data_pagamento);
        const obs   = p.observacao ? `  ${p.observacao}` : '';
        const val   = `R$ ${fmtBRL(p.valor)}`;
        return `${data}${obs.padEnd(W - 10 - val.length - 2).slice(0, W - 10 - val.length - 2)}  ${val}`;
      });

  const dir = (label: string, val: string) => {
    const s = `${label} ${val}`;
    return s.padStart(W);
  };

  return [
    '',
    centro(nomeLoja.toUpperCase()),
    centro('Conta A Prazo'),
    '',
    sep,
    `Cliente : ${idCliente}${cliente.nome}`,
    telCliente ? `Telefone: ${telCliente}` : null,
    periodo,
    '',
    sep,
    headerItens,
    sep,
    ...linhasItens,
    '',
    sep,
    `--- PAGAMENTOS ---`,
    sep,
    '',
    ...linhasPags,
    '',
    sep,
    '',
    dir('Total Compras :', `R$ ${fmtBRL(totalCompras)}`),
    dir('Total Pago    :', `R$ ${fmtBRL(totalPago)}`),
    dir(`${saldo > 0 ? 'Saldo em Aberto' : 'Conta Zerada  '} :`, `R$ ${fmtBRL(Math.abs(saldo))}`),
    '',
    sep,
  ].filter(l => l !== null).join('\n');
}

function gerarNomeArquivo(opts: OptsImpressao): string {
  const id = opts.cliente.id ? `${opts.cliente.id} - ` : '';
  const nome = opts.cliente.nome.replace(/[^a-zA-Z0-9\u00C0-\u00FF ]/g, '').trim();
  const de = opts.dataInicial ? ` de ${opts.dataInicial.replace(/\//g,'-')}` : '';
  const ate = opts.dataFinal ? ` até ${opts.dataFinal.replace(/\//g,'-')}` : '';
  return `${id}${nome}${de}${ate}.txt`;
}

function gerarHtml(opts: OptsImpressao): string {
  const { nomeLoja, cliente, itens, pagamentos, dataInicial, dataFinal } = opts;
  const totalCompras = itens.reduce((a, i) => a + i.valor_total, 0);
  const totalPago = pagamentos.reduce((a, p) => a + p.valor, 0);
  const saldo = totalCompras - totalPago;
  const periodo = dataInicial && dataFinal ? `Período: ${dataInicial} até ${dataFinal}` : `Emitido em: ${getTodayStr()}`;

  const itensRows = itens.map(i =>
    `<tr><td>${isoToBr(i.data_venda)}</td><td>${i.produto_nome}</td><td style="text-align:center">${i.quantidade}x</td><td style="text-align:right">R$ ${fmtBRL(i.valor_total)}</td></tr>`
  ).join('') || `<tr><td colspan="4" style="color:#888">Nenhuma compra</td></tr>`;

  const pagsRows = pagamentos.map(p =>
    `<tr><td>${isoToBr(p.data_pagamento)}</td><td colspan="2">${p.observacao || ''}</td><td style="text-align:right">R$ ${fmtBRL(p.valor)}</td></tr>`
  ).join('') || `<tr><td colspan="4" style="color:#888">Nenhum pagamento</td></tr>`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    *{box-sizing:border-box;margin:0;padding:0}
    html,body{height:100%;background:#1a1a1a;color:#e8e8e8;font-family:Arial,sans-serif}
    body{display:flex;flex-direction:column;min-height:100vh}
    .content{flex:1;padding:28px 32px 16px}
    h1{text-align:center;font-size:20px;font-weight:900;letter-spacing:1px;color:#fff;margin-bottom:3px}
    .sub{text-align:center;font-size:11px;color:#888;margin-bottom:14px}
    .divider{border:none;border-top:1px solid #333;margin:10px 0}
    .info p{font-size:12px;margin-bottom:3px;color:#ccc}
    .info strong{color:#fff}
    .periodo{font-size:11px;color:#777;margin-top:4px}
    table{width:100%;border-collapse:collapse;margin-top:10px}
    th{font-size:10px;text-transform:uppercase;color:#777;padding:4px 6px;border-bottom:1px solid #333;text-align:left}
    td{padding:4px 6px;font-size:12px;color:#ddd;border-bottom:1px solid #222}
    tr:last-child td{border-bottom:none}
    .sep td{font-size:10px;text-transform:uppercase;color:#777;padding:6px 6px 2px;border-bottom:1px solid #333;letter-spacing:.5px}
    .tot td{font-weight:bold;font-size:13px;padding:5px 6px;color:#fff;border-bottom:1px solid #2a2a2a}
    .sal td{font-weight:900;font-size:14px;padding:6px 6px;color:#fff}
    .footer{padding:16px 32px 24px;border-top:1px solid #2a2a2a;display:flex;gap:12px;justify-content:flex-end;background:#1a1a1a}
    .btn{padding:10px 28px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;border:none;transition:opacity .15s}
    .btn-print{background:#e07820;color:#fff;outline:none}
    .btn-print:hover{opacity:.8}
    .btn-print:focus{ring:2px solid #e07820;box-shadow:0 0 0 2px #1a1a1a, 0 0 0 4px #e07820}
    @media print{
      .footer{display:none}
      body{background:#fff;color:#111}
      h1,.sub,.info p,.info strong,.periodo{color:#111}
      th{color:#555;border-bottom:1px solid #aaa}
      td{color:#222;border-bottom:1px solid #ddd}
      .sep td{color:#555;border-bottom:1px solid #aaa}
      .tot td,.sal td{color:#111}
      .divider{border-color:#aaa}
      table{margin-top:6px}
    }
  </style></head><body>
  <script>document.addEventListener('contextmenu',e=>e.preventDefault())<\/script>
  <div class="content">
    <h1>${nomeLoja.toUpperCase()}</h1>
    <p class="sub">Conta A Prazo</p>
    <hr class="divider">
    <div class="info">
      <p><strong>Cliente:</strong> ${cliente.nome}</p>
      ${cliente.telefone ? `<p><strong>Telefone:</strong> ${cliente.telefone}</p>` : ''}
      <p class="periodo">${periodo}</p>
    </div>
    <table>
      <thead><tr><th>Data</th><th>Produto</th><th style="text-align:center">Qtd</th><th style="text-align:right">Total</th></tr></thead>
      <tbody>
        ${itensRows}
        <tr class="sep"><td colspan="4">Pagamentos</td></tr>
        ${pagsRows}
      </tbody>
      <tfoot>
        <tr><td colspan="4" style="border-top:1px solid #333;padding:0"></td></tr>
        <tr class="tot"><td colspan="3">Total Compras</td><td style="text-align:right">R$ ${fmtBRL(totalCompras)}</td></tr>
        <tr class="tot"><td colspan="3">Total Pago</td><td style="text-align:right">R$ ${fmtBRL(totalPago)}</td></tr>
        <tr class="sal"><td colspan="3">${saldo > 0 ? 'Saldo em Aberto' : 'Conta Zerada'}</td><td style="text-align:right">R$ ${fmtBRL(Math.abs(saldo))}</td></tr>
      </tfoot>
    </table>
  </div>
  <div class="footer">
    <button class="btn btn-print" id="btnImprimir">Imprimir</button>
  </div>
  <script>
    const btn = document.getElementById('btnImprimir');
    btn.addEventListener('click', function() {
      if (window.__TAURI__) {
        window.__TAURI__.core.invoke('executar_impressao').catch(function(e) { alert('Erro: ' + e); });
      } else {
        window.print();
      }
    });

    // Capture phase listener for Escape
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        try {
          if (window.__TAURI__ && window.__TAURI__.window) {
            window.__TAURI__.window.getCurrentWindow().close();
          } else {
            window.close();
          }
        } catch (err) {
          window.close();
        }
      }
    }, true);

    // Initial focus
    setTimeout(function() { btn.focus(); }, 100);
  <\/script>
  </body></html>`;
}

// ─── Modal de opções de impressão ────────────────────────────────────
function ModalImpressao({ opts, onClose }: { opts: OptsImpressao; onClose: () => void }) {
  const [status, setStatus] = useState<string | null>(null);
  const [pendingTempPath, setPendingTempPath] = useState<string | null>(null);
  const [focusedIdx, setFocusedIdx] = useState(0); // 0: Salvar, 1: WhatsApp, 2: Imprimir, 3: Fechar
  const [isPrinting, setIsPrinting] = useState(false);

  const btnSalvarRef = useRef<HTMLButtonElement>(null);
  const btnWhaRef = useRef<HTMLButtonElement>(null);
  const btnImpRef = useRef<HTMLButtonElement>(null);
  const btnCloseRef = useRef<HTMLButtonElement>(null);

  const refs = [btnSalvarRef, btnWhaRef, btnImpRef, btnCloseRef];

  useEffect(() => {
    setTimeout(() => btnSalvarRef.current?.focus(), 50);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isPrinting) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = (focusedIdx + 1) % 4;
        setFocusedIdx(next);
        refs[next].current?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = (focusedIdx - 1 + 4) % 4;
        setFocusedIdx(prev);
        refs[prev].current?.focus();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [focusedIdx, pendingTempPath]);

  const handleClose = async () => {
    if (pendingTempPath) {
      await invoke('deletar_arquivo', { path: pendingTempPath }).catch(() => {});
    }
    onClose();
  };

  const handleSalvarTxt = async () => {
    const txt = gerarTxt(opts);
    const defaultName = gerarNomeArquivo(opts);
    try {
      const path = await save({ defaultPath: defaultName, filters: [{ name: 'Texto', extensions: ['txt'] }] });
      if (!path) return;
      await invoke('salvar_txt', { path, conteudo: txt });
      setStatus('Arquivo salvo!');
      setTimeout(onClose, 1200);
    } catch (e) {
      setStatus('Erro ao salvar: ' + String(e));
    }
  };

  const handleWhatsApp = async () => {
    const txt = gerarTxt(opts);
    const nomeArq = gerarNomeArquivo(opts);
    try {
      const tempPath = await invoke<string>('salvar_txt_temp', { nome: nomeArq, conteudo: txt });
      await invoke('copiar_arquivo_clipboard', { path: tempPath });
      setPendingTempPath(tempPath);
      setStatus('Arquivo copiado! Cole no WhatsApp (Ctrl+V / Cmd+V) e depois feche.');
    } catch (e) {
      setStatus('Erro: ' + String(e));
    }
  };

  const handleImprimir = async () => {
    if (isPrinting) return;
    setIsPrinting(true);
    setStatus('Preparando impressão...');
    try {
      // Salva o HTML sem abrir janela
      await invoke('salvar_temp_html', { conteudo: gerarHtml(opts) });
      // Chama o comando de impressão do sistema
      await invoke('executar_impressao');
      setStatus('Enviado para impressora!');
      setTimeout(onClose, 1500);
    } catch (e) {
      console.error('Erro ao imprimir:', e);
      setStatus('Erro: ' + String(e));
      setIsPrinting(false);
    }
  };

  return (
    <ModalOverlay onClose={handleClose} zIndex={400}>
      <div className="glass-card w-full max-w-sm p-8">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-black italic text-luxury-orange uppercase">Exportar Conta</h3>
          <button onClick={handleClose} className="text-white/40 hover:text-white"><X size={20} /></button>
        </div>
        <div className="space-y-3">
          <button ref={btnSalvarRef} onClick={handleSalvarTxt}
            onFocus={() => setFocusedIdx(0)}
            className={`w-full h-13 px-4 py-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 text-white font-bold text-sm transition-colors flex items-center gap-3 outline-none
              ${focusedIdx === 0 ? 'ring-2 ring-luxury-orange' : ''}`}>
            <FileDown size={18} className="text-luxury-orange shrink-0" />
            <div className="text-left">
              <p className="font-bold">Salvar TXT</p>
              <p className="text-white/40 text-xs font-normal">Escolhe onde salvar o arquivo</p>
            </div>
          </button>
          <button ref={btnWhaRef} onClick={handleWhatsApp}
            onFocus={() => setFocusedIdx(1)}
            className={`w-full h-13 px-4 py-3 rounded-xl bg-white/5 border border-white/10 hover:bg-green-500/10 hover:border-green-500/20 text-white font-bold text-sm transition-colors flex items-center gap-3 outline-none
              ${focusedIdx === 1 ? 'ring-2 ring-green-500' : ''}`}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="#22c55e" className="shrink-0"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>
            <div className="text-left">
              <p className="font-bold">Copiar para WhatsApp</p>
              <p className="text-white/40 text-xs font-normal">Copia e Cola no WhatsApp (Ctrl+V)</p>
            </div>
          </button>
          <div className="relative">
            <button ref={btnImpRef} onClick={handleImprimir}
              onFocus={() => setFocusedIdx(2)}
               disabled={isPrinting}
              className={`w-full h-13 px-4 py-3 rounded-xl bg-luxury-orange/10 border border-luxury-orange/30 hover:bg-luxury-orange hover:border-luxury-orange text-luxury-orange hover:text-white font-bold text-sm transition-colors flex items-center gap-3 outline-none disabled:opacity-50
                ${focusedIdx === 2 ? 'ring-2 ring-luxury-orange' : ''}`}>
              <Printer size={18} className="shrink-0" />
              <div className="text-left">
                <p className="font-bold">Imprimir</p>
                <p className="text-xs font-normal opacity-60">Envia para a impressora padrão</p>
              </div>
            </button>
            {isPrinting && (
              <div className="absolute left-4 right-4 bottom-1 h-0.5 bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-luxury-orange animate-progress-fast" />
              </div>
            )}
          </div>
        </div>
        {/* Área fixa de status + botão fechar — sempre ocupa o mesmo espaço */}
        <div className="mt-4 h-16 flex flex-col items-center justify-center gap-1.5">
          {status ? (
            <p className="text-green-400 text-xs text-center">{status}</p>
          ) : (
            <div className="h-4" />
          )}
          <button ref={btnCloseRef} onClick={handleClose}
            onFocus={() => setFocusedIdx(3)}
            className={`w-full h-9 rounded-xl bg-white/5 border border-white/10 text-white/60 hover:text-white font-bold text-xs uppercase transition-colors outline-none
              ${focusedIdx === 3 ? 'ring-2 ring-white/50' : ''}`}>
            Fechar
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}

// ══════════════════════════════════════════════════════════════════════
// SUB-TELA: ARQUIVADOS
// ══════════════════════════════════════════════════════════════════════
interface ContaArquivada {
  id: number;
  cliente_id: number;
  cliente_nome: string;
  cliente_telefone: string | null;
  data_arquivo: string;
  total_compras: number;
  total_pago: number;
  itens_json: string | null;
  pagamentos_json: string | null;
}

function TelaArquivados({ db }: { db: any }) {
  const [arquivados, setArquivados] = useState<ContaArquivada[]>([]);
  const [search, setSearch] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<ContaArquivada | null>(null);
  const [visualizando, setVisualizando] = useState<ContaArquivada | null>(null);
  const [optsImpressaoArq, setOptsImpressaoArq] = useState<OptsImpressao | null>(null);
  const [nomeLoja, setNomeLoja] = useState('ERI Salgados');

  const filtered = arquivados.filter(a =>
    a.cliente_nome.toLowerCase().includes(search.toLowerCase())
  );

  const totalArquivado = filtered.reduce((a, r) => a + r.total_compras, 0);

  // Navegação
  const [navZone, setNavZone] = useState<'search' | 'list'>('search');
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);

  useEffect(() => {
    // Foco inicial
    setTimeout(() => { searchRef.current?.focus(); }, 100);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Se estiver visualizando modal ou confirmando delete, ignora
      if (visualizando || deleteConfirm) return;

      if (navZone === 'search') {
        if (e.key === 'ArrowDown' && filtered.length > 0) {
          e.preventDefault();
          setNavZone('list'); setFocusedIdx(0);
          setTimeout(() => rowRefs.current[0]?.focus(), 10);
        }
      } else if (navZone === 'list') {
        if (focusedIdx !== null) {
          if (e.key === 'ArrowDown' && focusedIdx < filtered.length - 1) {
            e.preventDefault(); setFocusedIdx(focusedIdx + 1);
            setTimeout(() => rowRefs.current[focusedIdx + 1]?.focus(), 10);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (focusedIdx > 0) {
              setFocusedIdx(focusedIdx - 1);
              setTimeout(() => rowRefs.current[focusedIdx - 1]?.focus(), 10);
            } else {
              setNavZone('search'); setFocusedIdx(null);
              searchRef.current?.focus();
            }
          } else if (e.key === 'Enter') {
            e.preventDefault();
            setVisualizando(filtered[focusedIdx]);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setNavZone('search'); setFocusedIdx(null);
            searchRef.current?.focus();
          }
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navZone, focusedIdx, filtered, visualizando, deleteConfirm]);

  useEffect(() => {
    if (!db) return;
    db.select("SELECT nome_loja FROM configuracoes WHERE id=1")
      .then((r: any[]) => { if (r[0]?.nome_loja) setNomeLoja(r[0].nome_loja); });
  }, [db]);

  const load = async () => {
    if (!db) return;
    const rows: ContaArquivada[] = (await db.select(
      "SELECT * FROM contas_arquivadas ORDER BY data_arquivo DESC, id DESC"
    )) || [];
    setArquivados(rows);
  };

  useEffect(() => { load(); }, [db]);

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    await db.execute("DELETE FROM contas_arquivadas WHERE id=$1", [deleteConfirm.id]);
    setDeleteConfirm(null);
    load();
  };



  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex items-center gap-3 shrink-0">
        <div className="relative flex-1">
          <Search size={16} className={`absolute left-3 top-1/2 -translate-y-1/2 transition-colors
            ${navZone === 'search' ? 'text-luxury-orange' : 'text-white/30'}`} />
          <input
            ref={searchRef}
            type="text"
            autoComplete="off"
            placeholder="Buscar cliente..."
            className={`w-full pl-9 h-11 bg-white/5 border-2 rounded-xl text-white font-medium transition-all outline-none
              ${navZone === 'search' ? 'border-luxury-orange shadow-[0_0_15px_rgba(224,120,32,0.15)] bg-white/10' : 'border-white/10'}`}
            value={search}
            onChange={e => { setSearch(e.target.value); setFocusedIdx(null); if (navZone !== 'search') setNavZone('search'); }}
            onFocus={() => { setNavZone('search'); setFocusedIdx(null); }}
          />
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-white/30 uppercase font-bold">Total arquivado</p>
          <p className="text-lg font-black text-white/60">R$ {fmtBRL(totalArquivado)}</p>
        </div>
      </div>

      <div className="flex-1 overflow-auto glass-card">
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-luxury-dark-gray/90 backdrop-blur-sm">
            <tr className="border-b border-white/5 text-xs uppercase tracking-widest text-white/40">
              <th className="px-4 py-3">Código</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3 text-center">Data Arq.</th>
              <th className="px-4 py-3 text-right">Compras</th>
              <th className="px-4 py-3 text-right">Pago</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-white/30 text-sm">Nenhuma conta arquivada</td></tr>
            )}
            {filtered.map((a, idx) => (
              <tr key={a.id}
                ref={el => { rowRefs.current[idx] = el; }}
                tabIndex={0}
                className={`border-b border-white/5 transition-all outline-none cursor-pointer
                  ${focusedIdx === idx ? 'bg-white/10' : 'hover:bg-white/5 opacity-80'}`}
                onClick={() => setVisualizando(a)}>
                <td className="px-4 py-3">
                  <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] text-luxury-orange font-mono font-bold uppercase tracking-wider">
                    {(a as any).codigo_arquivamento || `#${a.id}`}
                  </span>
                </td>
                <td className="px-4 py-3 font-semibold text-white">{a.cliente_nome}</td>
                <td className="px-4 py-3 text-center text-white/40 font-mono text-sm">{isoToBr(a.data_arquivo)}</td>
                <td className="px-4 py-3 text-right text-white/60 font-mono text-sm">R$ {fmtBRL(a.total_compras)}</td>
                <td className="px-4 py-3 text-right font-mono text-green-400 text-sm font-bold">R$ {fmtBRL(a.total_pago)}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={e => { e.stopPropagation(); setDeleteConfirm(a); }}
                    className={`transition-opacity p-1.5 hover:bg-red-500/10 rounded-lg text-white/40 hover:text-red-500
                      ${focusedIdx === idx ? 'opacity-100' : 'opacity-0'}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal visualização conta arquivada */}
      {visualizando && (() => {
        const parseJson = (val: any) => {
          if (!val) return [];
          if (typeof val !== 'string') return val;
          try { return JSON.parse(val); } catch(e) { console.error("Erro parseJson:", e); return []; }
        };
        const itens: ItemLinha[] = parseJson(visualizando.itens_json);
        const pags: Pagamento[] = parseJson(visualizando.pagamentos_json);
        return (
          <ModalOverlay onClose={() => setVisualizando(null)} zIndex={300}>
            <div className="glass-card w-full max-w-2xl p-0 overflow-hidden flex flex-col" style={{maxHeight:'80vh'}}>
              {/* Header modal */}
              <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between shrink-0">
                <div>
                  <h3 className="text-xl font-black italic text-luxury-orange uppercase">{visualizando.cliente_nome}</h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-white/40 text-xs text-xs">Arquivado em {isoToBr(visualizando.data_arquivo)}</p>
                    {(visualizando as any).codigo_arquivamento && (
                      <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] text-luxury-orange font-mono font-bold uppercase tracking-wider">
                        {(visualizando as any).codigo_arquivamento}
                      </span>
                    )}
                    {visualizando.cliente_telefone && <span className="text-white/20 text-xs">· {visualizando.cliente_telefone}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setOptsImpressaoArq({ nomeLoja, cliente: { id: visualizando.cliente_id, nome: visualizando.cliente_nome, telefone: visualizando.cliente_telefone }, itens, pagamentos: pags })}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 hover:text-white text-xs font-bold uppercase transition-colors"
                  >
                    <Printer size={13} /> Imprimir
                  </button>
                  <button onClick={() => setVisualizando(null)} className="text-white/40 hover:text-white ml-1"><X size={20} /></button>
                </div>
              </div>
              {/* Corpo */}
              <div className="flex flex-1 overflow-hidden">
                {/* Itens */}
                <div className="flex-1 flex flex-col overflow-hidden border-r border-white/5">
                  <p className="px-4 py-2 text-xs uppercase tracking-widest text-white/40 font-bold border-b border-white/5 shrink-0">Compras ({itens.length})</p>
                  <div className="flex-1 overflow-auto">
                    {itens.length === 0 && <p className="text-center text-white/30 text-sm py-6">Nenhuma compra</p>}
                    {itens.map((item: any, i) => (
                      <div key={i} className="flex items-center gap-3 px-4 py-2 border-b border-white/5 text-sm hover:bg-white/[0.02] transition-colors">
                        <span className="font-mono text-white/40 w-28 shrink-0 text-xs">{isoToBr(item.data_venda || '')}</span>
                        <span className="flex-1 text-white font-semibold truncate uppercase">{item.produto_nome || 'Produto'}</span>
                        <span className="text-white/40 w-8 text-right shrink-0">{item.quantidade || 0}x</span>
                        <span className="text-luxury-orange font-black w-24 text-right font-mono shrink-0">
                          R$ {fmtBRL(item.valor_total || 0)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Pagamentos */}
                <div className="w-60 flex flex-col overflow-hidden">
                  <p className="px-4 py-2 text-xs uppercase tracking-widest text-white/40 font-bold border-b border-white/5 shrink-0">Pagamentos</p>
                  <div className="flex-1 overflow-auto">
                    {pags.length === 0 && <p className="text-center text-white/30 text-xs py-6">Nenhum</p>}
                    {pags.map((p, i) => (
                      <div key={i} className="flex items-center gap-2 px-3 py-2 border-b border-white/5 text-sm">
                        <div className="flex-1 min-w-0">
                          <p className="font-mono text-xs text-white/50">{isoToBr(p.data_pagamento)}</p>
                          {p.observacao && <p className="text-white/30 text-xs truncate">{p.observacao}</p>}
                        </div>
                        <span className="text-green-400 font-black text-sm shrink-0">R$ {fmtBRL(p.valor)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {/* Totais footer */}
              <div className="px-6 py-3 border-t border-white/5 flex gap-6 justify-end shrink-0">
                <div className="text-right">
                  <p className="text-xs text-white/30 uppercase font-bold">Compras</p>
                  <p className="font-black text-white">R$ {fmtBRL(visualizando.total_compras)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-white/30 uppercase font-bold">Pago</p>
                  <p className="font-black text-green-400">R$ {fmtBRL(visualizando.total_pago)}</p>
                </div>
              </div>
            </div>
          </ModalOverlay>
        );
      })()}

      {deleteConfirm && (
        <ConfirmModal
          msg="Excluir registro?"
          item={`${deleteConfirm.cliente_nome} — ${isoToBr(deleteConfirm.data_arquivo)}`}
          onConfirm={handleDelete}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}

      {optsImpressaoArq && (
        <ModalImpressao opts={optsImpressaoArq} onClose={() => setOptsImpressaoArq(null)} />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ══════════════════════════════════════════════════════════════════════
export default function APrazo() {
  const { db } = useDatabase();
  const [subTela, setSubTela] = useState<SubTela>('clientes');
  const [clienteSelecionado, setClienteSelecionado] = useState<Cliente | null>(null);
  const [contaAutoFocus, setContaAutoFocus] = useState(false);

  const handleVerConta = (c: Cliente, autoFocus = false) => {
    setClienteSelecionado(c);
    setContaAutoFocus(autoFocus);
    setSubTela('conta');
  };

  const tabs: { id: SubTela; label: string; icon: any }[] = [
    { id: 'clientes', label: 'Clientes', icon: Users },
    { id: 'saldo', label: 'Saldo Geral', icon: BarChart2 },
    { id: 'arquivados', label: 'Arquivados', icon: FolderOpen },
  ];

  // F1/F2/F3 para trocar abas
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F1') { e.preventDefault(); setSubTela('clientes'); }
      else if (e.key === 'F2') { e.preventDefault(); setSubTela('saldo'); }
      else if (e.key === 'F3') { e.preventDefault(); setSubTela('arquivados'); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="flex flex-col h-full gap-4 overflow-hidden">
      {/* Tabs */}
      <div className="flex items-center gap-2 shrink-0">
        <h1 className="text-3xl font-black italic text-luxury-orange uppercase mr-4">A Prazo</h1>
        {tabs.map((t, i) => (
          <button key={t.id} onClick={() => setSubTela(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold uppercase tracking-wide transition-all ${
              subTela === t.id
                ? 'bg-luxury-orange/10 border border-luxury-orange/30 text-luxury-orange'
                : 'text-white/40 border border-transparent hover:bg-white/5 hover:text-white'
            }`}
            title={`F${i + 1}`}
          >
            <t.icon size={15} />
            {t.label}
            <span className="ml-1 px-1 py-0.5 rounded text-[10px] font-mono font-bold normal-case tracking-normal bg-white/10 text-white/50">F{i + 1}</span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        {subTela === 'clientes' && db && <TelaClientes db={db} onVerConta={handleVerConta} autoFocusClienteId={clienteSelecionado?.id ?? null} />}
        {subTela === 'conta' && clienteSelecionado && db && <TelaConta db={db} cliente={clienteSelecionado} onVoltar={() => setSubTela('clientes')} autoFocusItems={contaAutoFocus} />}
        {subTela === 'saldo' && db && <TelaSaldoGeral db={db} onVerConta={handleVerConta} />}
        {subTela === 'arquivados' && db && <TelaArquivados db={db} />}
      </div>
    </div>
  );
}
