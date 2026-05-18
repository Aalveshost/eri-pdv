import { useState, useEffect, useRef, Fragment } from "react";
import { Plus, Package, TrendingUp, Edit2, Trash2, Search, AlertTriangle } from "lucide-react";
import { useDatabase } from "../hooks/useDatabase";
import Modal from "../components/Modal";
import { cn } from "../utils/cn";
import { normalizeText } from "../utils/text";
import { handleCurrencyInput, handleWeightInput, finalizeWeightInput, parseCurrencyToNumber } from "../utils/currency";

let producaoShouldFocusOnMount = false;
export const setProducaoShouldFocusOnMount = (val: boolean) => { producaoShouldFocusOnMount = val; };

interface Producao {
  id: number;
  produto_id: number | null;
  produto_nome: string;
  data_producao: string;
  qtd_produzida: number;
  qtd_vendida: number;
  sobra: number;
}

interface Produto {
  id: number;
  nome: string;
}

// ─── helpers de data ────────────────────────────────────────────────
function brToIso(br: string): string {
  const [d, m, y] = br.split('/');
  if (!d || !m || !y) return '';
  return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
}

function isoToBr(iso: string): string {
  if (!iso) return '';
  const datePart = iso.split(' ')[0];
  const [y, m, d] = datePart.split('-');
  return `${d}/${m}/${y}`;
}

function isoToTime(iso: string): string {
  if (!iso || !iso.includes(' ')) return '00:00';
  return iso.split(' ')[1].slice(0, 5);
}

function getCurrentTime(): string {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// ─── Componente de input de data ─────────────────────
function DateInput({ value, onChange, label, externalRef, highlighted, active, onFocus, onKeyDown, id }: { value: string; onChange: (v: string) => void; label?: string; externalRef?: React.RefObject<HTMLInputElement | null>; highlighted?: boolean; active?: boolean; onFocus?: () => void; onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void; id?: string }) {
  const localRef = useRef<HTMLInputElement>(null);
  const inputRef = externalRef || localRef;
  const displayValue = value || '__/__/____';

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const isDigit = /^\d$/.test(e.key);
    const formatDate = (v: string) => `${v.slice(0,2)}/${v.slice(2,4)}/${v.slice(4,8)}`;
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
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab', 'Enter', 'Escape'].includes(e.key)) return;
    e.preventDefault();
  };

  return (
    <div className="flex flex-col">
      {label && <label className="block text-[10px] uppercase tracking-[0.2em] text-white/30 font-bold mb-1.5">{label}</label>}
      <input id={id} ref={inputRef} type="text" className={`luxury-input h-14 font-mono text-center tracking-widest w-full ${active ? 'border-luxury-orange ring-2 ring-luxury-orange/40 bg-luxury-orange/5' : highlighted ? 'bg-white/5' : ''}`} value={displayValue} onChange={() => {}} onFocus={e => { e.currentTarget.setSelectionRange(0, 0); onFocus?.(); }} onBlur={e => e.currentTarget.setSelectionRange(0, 0)} onKeyDown={e => { handleKeyDown(e); onKeyDown?.(e); }} placeholder="__/__/____" />
    </div>
  );
}

// ─── Componente de input de hora ──────────────────────────
function TimeInput({ value, onChange, label, onKeyDown, id }: { value: string; onChange: (v: string) => void; label?: string; onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void; id?: string }) {
  const displayValue = value || '__:__';
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const isDigit = /^\d$/.test(e.key);
    const displayPos = input.selectionStart || 0;
    const rawPos = displayPos <= 2 ? displayPos : displayPos - 1;
    const prevRaw = (displayValue.replace(/:/g, '') + '____').slice(0, 4);

    if (isDigit && rawPos < 4) {
      e.preventDefault();
      const d = prevRaw.split('');
      d[rawPos] = e.key;
      const nd = d.join('');
      const newDisp = `${nd.slice(0,2)}:${nd.slice(2,4)}`;
      onChange(newDisp);
      const nextRaw = rawPos + 1;
      const nextDisp = nextRaw <= 2 ? nextRaw : nextRaw + 1;
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
      const newDisp = `${nd.slice(0,2)}:${nd.slice(2,4)}`;
      onChange(newDisp);
      const nextDisp = posToDel <= 2 ? posToDel : posToDel + 1;
      setTimeout(() => input.setSelectionRange(nextDisp, nextDisp), 0);
      return;
    }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab', 'Enter', 'Escape'].includes(e.key)) return;
    e.preventDefault();
  };

  return (
    <div className="flex flex-col gap-2">
      {label && <label className="text-xs uppercase tracking-widest text-white/40 font-bold ml-1">{label}</label>}
      <input id={id} type="text" value={displayValue} onKeyDown={e => { handleKeyDown(e); onKeyDown?.(e); }} onFocus={e => e.currentTarget.setSelectionRange(0, 0)} className="luxury-input w-full h-14 text-center text-xl font-black italic tracking-widest" />
    </div>
  );
}

export default function ProducaoPage() {
  const { db } = useDatabase();
  const [producoes, setProducoes] = useState<Producao[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<Producao | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [selectedDate, setSelectedDate] = useState(new Date().toLocaleDateString('sv-SE'));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [inputActive, _setInputActive] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProd, setSelectedProd] = useState<Produto | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [activeSuggestionIdx, setActiveSuggestionIdx] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isQuickAddMode, setIsQuickAddMode] = useState(false);
  const [quickForm, setQuickForm] = useState({ v: "0,00", c: "0,00" });
  const [editItem, setEditItem] = useState<Producao | null>(null);
  const [editForm, setEditForm] = useState({ produzido: "", data: "", hora: "" });
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const wasAnyModalOpen = useRef(false);

  const filteredSuggestions = produtos.filter(p => normalizeText(p.nome).includes(normalizeText(searchTerm))).slice(0, 3);

  const openModal = () => { setIsModalOpen(true); };
  const closeModal = () => { 
    setIsModalOpen(false); 
    setIsQuickAddMode(false); 
    setEditItem(null); 
    setSearchTerm(""); 
    setSelectedProd(null); 
    setTimeout(() => document.getElementById('btn-registrar')?.focus(), 150); 
  };

  const loadData = async () => {
    if (!db) return;
    try {
      const prodRes: any[] = await db.select("SELECT id, nome FROM produtos WHERE ativo = 1 ORDER BY nome ASC");
      setProdutos(prodRes);
      const producoesRes: any[] = await db.select(`SELECT l.id, l.produto_id, COALESCE(p.nome, l.produto_avulso_nome) as produto_nome, l.data_fabricacao as data_producao, l.qtd_inicial as qtd_produzida FROM lotes l LEFT JOIN produtos p ON l.produto_id = p.id WHERE date(l.data_fabricacao) = date($1) ORDER BY l.id DESC`, [selectedDate]);
      const vendasRes: any[] = await db.select(`SELECT vi.produto_id, SUM(vi.quantidade) as total_vendido FROM venda_itens vi JOIN vendas v ON v.id = vi.venda_id WHERE date(v.data_venda) = date($1) GROUP BY vi.produto_id`, [selectedDate]);
      const vendasMap: Record<number, number> = {};
      vendasRes.forEach(v => { if (v.produto_id) vendasMap[v.produto_id] = v.total_vendido; });
      const finalData = producoesRes.map(p => {
        const totalVendidoDia = p.produto_id ? (vendasMap[p.produto_id] || 0) : 0;
        return { id: p.id, produto_id: p.produto_id, produto_nome: p.produto_nome, data_producao: p.data_producao, qtd_produzida: p.qtd_produzida, qtd_vendida: totalVendidoDia, sobra: p.qtd_produzida - totalVendidoDia };
      });
      setProducoes(finalData);
    } catch (err) { console.error(err); }
  };

  useEffect(() => { loadData(); }, [db, selectedDate]);

  // Track modal state for focus return
  useEffect(() => {
    if (isModalOpen || !!editItem || isQuickAddMode) {
      wasAnyModalOpen.current = true;
    }
  }, [isModalOpen, editItem, isQuickAddMode]);

  // Initial Focus Logic
  useEffect(() => {
    if (db && !isModalOpen && !editItem && !isQuickAddMode) {
      setTimeout(() => {
        // Se for a montagem inicial via menu, segue a regra inteligente
        if (producaoShouldFocusOnMount) {
          const firstRow = document.querySelector('tbody tr[tabindex="0"]') as HTMLElement;
          if (firstRow) {
            firstRow.focus();
          } else {
            document.getElementById('btn-registrar')?.focus();
          }
          setProducaoShouldFocusOnMount(false);
          wasAnyModalOpen.current = false;
          return;
        }

        // Se estiver apenas fechando um modal, volta para o botão de registrar
        if (wasAnyModalOpen.current) {
          document.getElementById('btn-registrar')?.focus();
          wasAnyModalOpen.current = false;
        }
      }, 150);
    }
  }, [db, isModalOpen, editItem, isQuickAddMode]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement;
      setActiveId(active?.id || null);
      if (!active || isModalOpen || editItem || isQuickAddMode) return;
      
      if (active.id === 'btn-registrar') {
        if (e.key === 'ArrowDown') { e.preventDefault(); (document.querySelector('tbody tr[tabindex="0"]') as HTMLElement)?.focus(); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); document.getElementById('header-date-input')?.focus(); }
      } else if (active.id === 'header-date-input') {
        if (inputActive) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); (document.querySelector('tbody tr[tabindex="0"]') as HTMLElement)?.focus(); }
        if (e.key === 'ArrowRight') { e.preventDefault(); document.getElementById('btn-registrar')?.focus(); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isModalOpen, editItem, isQuickAddMode, inputActive]);

  const [form, setForm] = useState({ produzido: "", data: isoToBr(selectedDate), hora: getCurrentTime() });

  useEffect(() => {
    if (isModalOpen) {
      setForm({ produzido: "", data: isoToBr(selectedDate), hora: getCurrentTime() });
      setSearchTerm(""); setSelectedProd(null); setShowResults(false);
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [isModalOpen]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db) return;
    if (!searchTerm || !form.produzido) return;
    try {
      const parts = form.data.split('/');
      const isoDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
      const isoDateTime = `${isoDate} ${form.hora}:00`;
      await db.execute("INSERT INTO lotes (produto_id, produto_avulso_nome, data_fabricacao, data_validade, qtd_inicial, qtd_atual, qtd_vendida, status) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ativo')", [selectedProd?.id || null, selectedProd ? null : searchTerm.toUpperCase(), isoDateTime, isoDateTime, parseInt(form.produzido), parseInt(form.produzido), 0]);
      closeModal();
      loadData();
    } catch (err) { console.error(err); }
  };

  const handleQuickProductSave = async () => {
    if (!db || !searchTerm) return;
    try {
      const v = parseCurrencyToNumber(quickForm.v); const c = parseCurrencyToNumber(quickForm.c);
      const res = await db.execute("INSERT INTO produtos (nome, preco_venda, preco_custo, ativo) VALUES ($1, $2, $3, 1)", [searchTerm.toUpperCase(), v, c]);
      setSelectedProd({ id: res.lastInsertId || 0, nome: searchTerm.toUpperCase() }); setIsQuickAddMode(false); loadData();
    } catch (err) { console.error(err); }
  };

  const openEdit = (item: any) => { lastFocusedRef.current = document.activeElement as HTMLElement; setEditItem(item); setEditForm({ produzido: item.qtd_produzida.toString(), data: isoToBr(item.data_producao), hora: isoToTime(item.data_producao) }); };
  const closeEdit = () => { setEditItem(null); setTimeout(() => lastFocusedRef.current?.focus(), 50); };
  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!editItem || !db) return;
    const parts = editForm.data.split('/'); const isoDate = `${parts[2]}-${parts[1]}-${parts[0]}`; const isoDateTime = `${isoDate} ${editForm.hora}:00`;
    await db.execute("UPDATE lotes SET qtd_inicial=$1, data_fabricacao=$2 WHERE id=$3", [parseInt(editForm.produzido), isoDateTime, editItem.id]);
    closeEdit(); loadData();
  };

  const deleteItem = async (id: number) => { if (!db) return; await db.execute("DELETE FROM lotes WHERE id = $1", [id]); setItemToDelete(null); loadData(); };

  const totalProduzido = producoes.reduce((acc, p) => acc + p.qtd_produzida, 0);
  const totalVendido = producoes.reduce((acc, p) => acc + p.qtd_vendida, 0);
  const totalSobras = producoes.reduce((acc, p) => acc + p.sobra, 0);

  const groupedProducoes = producoes.reduce((acc, p) => {
    const key = p.produto_nome;
    if (!acc[key]) { acc[key] = { produto_nome: p.produto_nome, produto_id: p.produto_id, total_produzido: 0, total_vendido: p.qtd_vendida, total_sobra: 0, lotes: [] }; }
    acc[key].total_produzido += p.qtd_produzida; acc[key].total_sobra = acc[key].total_produzido - acc[key].total_vendido; acc[key].lotes.push(p);
    return acc;
  }, {} as any);

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-luxury-orange/20 flex items-center justify-center border border-luxury-orange/30"><Package className="text-luxury-orange" size={20} /></div>
            <h1 className="text-4xl font-black italic tracking-tighter uppercase">Controle de <span className="text-luxury-orange">Produção</span></h1>
          </div>
          <p className="text-white/40 font-bold ml-13 text-sm tracking-widest">Gestão diária de fabricação e vendas.</p>
        </div>
        <div className="flex items-end gap-4">
          <DateInput id="header-date-input" label="Data da Produção" value={isoToBr(selectedDate)} onChange={v => { if (!v.includes('_')) { const iso = brToIso(v); if (iso) setSelectedDate(iso); } }} highlighted={activeId === 'header-date-input'} active={inputActive} onFocus={() => setActiveId('header-date-input')} />
          <button id="btn-registrar" onClick={openModal} className="btn-primary h-14 px-8 flex items-center gap-3 transition-all outline-none focus:ring-2 focus:ring-white/20 focus:shadow-[0_0_15px_rgba(255,107,0,0.2)] border border-transparent focus:border-white/20 transition-all"><Plus size={20} /><span>Registrar Produção</span></button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10 opacity-60">
        {/* Card Produzido */}
        <div className="glass-card p-6 border border-white/5">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center"><Package className="text-white/40" size={24} /></div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] font-black text-white/40 mb-1">Produzido no Dia</p>
              <p className="text-3xl font-black italic tracking-tighter">{totalProduzido}</p>
            </div>
          </div>
        </div>
        {/* Card Vendido */}
        <div className="glass-card p-6 border border-white/5">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center"><TrendingUp className="text-green-500" size={24} /></div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] font-black text-white/40 mb-1">Vendido / Produzido</p>
              <p className="text-3xl font-black italic tracking-tighter text-green-500">{totalVendido} / {totalProduzido}</p>
            </div>
          </div>
        </div>
        {/* Card Sobras */}
        <div className="glass-card p-6 border border-white/5">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-red-500/10 flex items-center justify-center"><TrendingUp className="text-red-500 rotate-180" size={24} /></div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] font-black text-white/40 mb-1">Sobras do Dia</p>
              <p className="text-3xl font-black italic tracking-tighter text-red-500">{totalSobras}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="glass-card flex-1 overflow-auto">
        <table className="w-full text-left">
          <thead className="text-white/20 text-xs uppercase border-b border-white/5 sticky top-0 bg-luxury-dark-gray z-10">
            <tr><th className="px-6 py-4 font-medium">Produto</th><th className="px-6 py-4 text-center">Produzido</th><th className="px-6 py-4 text-center">Vendido</th><th className="px-6 py-4 text-center">Sobra</th><th className="px-6 py-4 text-right pr-10">Ações</th></tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {Object.values(groupedProducoes).map((group: any) => (
              <Fragment key={group.produto_nome}>
                <tr tabIndex={0} onClick={() => setExpandedGroups(prev => ({...prev, [group.produto_nome]: !prev[group.produto_nome]}))} 
                  onKeyDown={e => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedGroups(prev => ({ ...prev, [group.produto_nome]: !prev[group.produto_nome] })); }
                    else if (e.key === 'ArrowUp') { e.preventDefault(); const p = e.currentTarget.previousElementSibling as HTMLElement; if (p) p.focus(); else document.getElementById('btn-registrar')?.focus(); }
                    else if (e.key === 'ArrowDown') { e.preventDefault(); (e.currentTarget.nextElementSibling as HTMLElement)?.focus(); }
                  }}
                  className={cn("group cursor-pointer border-b border-white/5 transition-all outline-none hover:bg-white/5 focus:bg-luxury-orange/10", expandedGroups[group.produto_nome] && "bg-white/[0.02]")}>
                  <td className="px-6 py-5 flex items-center gap-4">
                    <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center transition-all bg-white/5", expandedGroups[group.produto_nome] && "rotate-180 bg-luxury-orange/20 text-luxury-orange")}>
                      <Plus size={16} />
                    </div>
                    <p className="font-black text-xl italic uppercase tracking-tighter">{group.produto_nome}</p>
                  </td>
                  <td className="px-6 py-5 text-center"><span className="bg-white/5 px-4 py-2 rounded-lg font-black text-xl">{group.total_produzido}</span></td>
                  <td className="px-6 py-5 text-center"><span className="text-green-500 font-black text-xl">{group.total_vendido}</span></td>
                  <td className="px-6 py-5 text-center"><span className={cn("px-4 py-2 rounded-lg font-black text-xl", group.total_sobra > 0 ? "text-red-500 bg-red-500/5" : "text-white/20")}>{group.total_sobra}</span></td>
                  <td className="px-6 py-5 text-right pr-10 uppercase text-[10px] font-black text-white/20 tracking-widest">Resumo do Dia</td>
                </tr>
                {expandedGroups[group.produto_nome] && group.lotes.map((lote: any) => (
                  <tr key={lote.id} tabIndex={0}
                    onKeyDown={e => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === 'ArrowUp') { e.preventDefault(); (e.currentTarget.previousElementSibling as HTMLElement)?.focus(); }
                      else if (e.key === 'ArrowDown') { e.preventDefault(); (e.currentTarget.nextElementSibling as HTMLElement)?.focus(); }
                      else if (e.key === 'Enter') { e.preventDefault(); document.getElementById(`btn-edit-${lote.id}`)?.focus(); }
                    }}
                    className="bg-black/40 border-b border-white/[0.02] group/child outline-none focus-within:bg-luxury-orange/10">
                    <td className="px-6 py-3 pl-16 text-sm font-black italic text-white/40 uppercase tracking-widest">Lote das {isoToTime(lote.data_producao)}</td>
                    <td className="px-6 py-3 text-center text-sm font-bold text-white/60 italic">{lote.qtd_produzida}</td>
                    <td className="px-6 py-3 text-center text-sm font-bold text-green-500/60 italic">-</td>
                    <td className="px-6 py-3 text-center text-sm font-bold text-red-500/60 italic">-</td>
                    <td className="px-6 py-3 text-right pr-10">
                      <div className="flex justify-end gap-2 opacity-0 group-hover/child:opacity-100 group-focus-within/child:opacity-100 transition-all">
                        <button id={`btn-edit-${lote.id}`} onClick={() => openEdit(lote)}
                          onKeyDown={e => {
                            if (e.key === 'ArrowRight') { e.preventDefault(); document.getElementById(`btn-delete-${lote.id}`)?.focus(); }
                            else if (e.key === 'Escape') { e.preventDefault(); (e.currentTarget.closest('tr') as HTMLElement)?.focus(); }
                          }}
                          className="p-2 rounded-lg hover:bg-white/10 text-white/20 focus:text-luxury-orange outline-none"><Edit2 size={14} /></button>
                        <button id={`btn-delete-${lote.id}`} onClick={() => setItemToDelete(lote)}
                          onKeyDown={e => {
                            if (e.key === 'ArrowLeft') { e.preventDefault(); document.getElementById(`btn-edit-${lote.id}`)?.focus(); }
                            else if (e.key === 'Escape') { e.preventDefault(); (e.currentTarget.closest('tr') as HTMLElement)?.focus(); }
                          }}
                          className="p-2 rounded-lg hover:bg-white/10 text-white/20 hover:text-red-500 focus:text-red-500 outline-none"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <Modal isOpen={isModalOpen} onClose={closeModal} title="REGISTRAR PRODUÇÃO DIÁRIA">
        <form onSubmit={handleSave} className="space-y-6">
          <div className="relative">
            <label className="block text-xs uppercase font-black text-white/40 mb-2 tracking-widest">Produto</label>
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" size={18} />
              <input id="input-search" ref={searchInputRef} type="text" placeholder="BUSCAR..." style={{ textTransform: 'uppercase' }} className="luxury-input w-full h-12 pl-12" value={searchTerm} onChange={e => { setSearchTerm(e.target.value.toUpperCase()); setShowResults(true); setSelectedProd(null); }} onFocus={() => setShowResults(true)}
                onKeyDown={e => {
                  if (e.key === 'ArrowDown') { 
                    e.preventDefault(); 
                    if (showResults && filteredSuggestions.length > 0 && !selectedProd) {
                      setActiveSuggestionIdx(p => (p + 1) % (filteredSuggestions.length + 1));
                    } else {
                      document.getElementById('input-produzido')?.focus();
                    }
                  }
                  else if (e.key === 'ArrowUp' && showResults && !selectedProd) { e.preventDefault(); setActiveSuggestionIdx(p => (p - 1 + (filteredSuggestions.length + 1)) % (filteredSuggestions.length + 1)); }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); }
                  else if (e.key === 'Enter') { 
                    e.preventDefault(); 
                    if (showResults && activeSuggestionIdx >= 0 && !selectedProd) { 
                      if (activeSuggestionIdx < filteredSuggestions.length) { 
                        const p = filteredSuggestions[activeSuggestionIdx]; 
                        setSelectedProd(p); 
                        setSearchTerm(p.nome.toUpperCase()); 
                        setShowResults(false); 
                        setTimeout(() => document.getElementById('input-produzido')?.focus(), 50); 
                      } else {
                        setIsQuickAddMode(true); 
                      }
                    } else {
                      document.getElementById('input-produzido')?.focus(); 
                    }
                  }
                }} />
              {showResults && searchTerm.length > 0 && !selectedProd && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-luxury-dark-gray border border-white/10 rounded-xl z-[400] shadow-2xl overflow-hidden">
                  {filteredSuggestions.map((p, i) => ( <button key={p.id} type="button" onClick={() => { setSelectedProd(p); setSearchTerm(p.nome.toUpperCase()); setShowResults(false); setTimeout(() => document.getElementById('input-produzido')?.focus(), 50); }} className={cn("w-full px-4 py-3 text-left border-b border-white/5", activeSuggestionIdx === i ? "bg-luxury-orange/20" : "hover:bg-luxury-orange/10")}><span className={cn("font-bold uppercase italic tracking-tighter", activeSuggestionIdx === i ? "text-luxury-orange" : "text-white")}>{p.nome}</span></button> ))}
                  <button type="button" onClick={() => setIsQuickAddMode(true)} className={cn("w-full px-4 py-3 text-left bg-luxury-orange/5 flex items-center justify-between", activeSuggestionIdx === filteredSuggestions.length ? "bg-luxury-orange/20" : "")}>
                    <span className="text-luxury-orange font-black text-[10px] uppercase tracking-widest">CADASTRAR "{searchTerm}"</span>
                    <Plus size={14} className="text-luxury-orange" />
                  </button>
                </div>
              )}
            </div>
          </div>
          <div>
            <label className="block text-xs uppercase font-black text-white/40 mb-2 tracking-widest">Qtd Produzida</label>
            <input id="input-produzido" type="number" className="luxury-input w-full h-12 text-xl font-black italic" value={form.produzido} onChange={e => setForm({...form, produzido: e.target.value})} onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); document.getElementById('date-input')?.focus(); } else if (e.key === 'ArrowUp') { e.preventDefault(); searchInputRef.current?.focus(); } }} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <DateInput id="date-input" label="Data da Produção" value={form.data} onChange={v => setForm({...form, data: v})} onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-confirm')?.focus(); } else if (e.key === 'ArrowUp') { e.preventDefault(); document.getElementById('input-produzido')?.focus(); } else if (e.key === 'ArrowRight') { e.preventDefault(); document.getElementById('time-input')?.focus(); } }} />
            <TimeInput id="time-input" label="Hora" value={form.hora} onChange={v => setForm({...form, hora: v})} onKeyDown={e => { if (e.key === 'ArrowUp') { e.preventDefault(); document.getElementById('input-produzido')?.focus(); } else if (e.key === 'ArrowLeft') { e.preventDefault(); document.getElementById('date-input')?.focus(); } else if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-confirm')?.focus(); } }} />
          </div>
          <div className="flex gap-4 pt-4">
            <button id="btn-cancel" type="button" onClick={closeModal} className="flex-1 h-14 border border-white/10 rounded-xl font-bold uppercase text-[10px] tracking-widest outline-none focus:bg-red-500/10 transition-all" onKeyDown={e => { if (e.key === 'ArrowRight') { e.preventDefault(); document.getElementById('btn-confirm')?.focus(); } else if (e.key === 'ArrowUp') { e.preventDefault(); document.getElementById('date-input')?.focus(); } }}>CANCELAR</button>
            <button id="btn-confirm" type="submit" className="btn-primary flex-1 h-14 font-black italic uppercase tracking-widest outline-none focus:ring-2 focus:ring-white/20 focus:shadow-[0_0_15px_rgba(255,107,0,0.2)] border border-transparent focus:border-white/20 transition-all" onKeyDown={e => { if (e.key === 'ArrowUp') { e.preventDefault(); document.getElementById('date-input')?.focus(); } else if (e.key === 'ArrowLeft') { e.preventDefault(); document.getElementById('btn-cancel')?.focus(); } }}>CONFIRMAR LANÇAMENTO</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={isQuickAddMode} onClose={() => setIsQuickAddMode(false)} title="NOVO PRODUTO">
        <div className="space-y-6">
          <div className="p-4 rounded-xl bg-luxury-orange/10 border border-luxury-orange/20"><p className="text-xl font-black italic uppercase text-white tracking-tighter">{searchTerm}</p></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] uppercase font-black text-white/20">Custo</label>
              <input 
                type="text" 
                autoFocus 
                className="luxury-input w-full h-12 font-bold" 
                value={quickForm.c} 
                onChange={e => setQuickForm({...quickForm, c: handleCurrencyInput(e.target.value)})} 
                placeholder="0,00" 
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] uppercase font-black text-white/20">Venda</label>
              <input 
                type="text" 
                className="luxury-input w-full h-12 font-bold text-luxury-orange" 
                value={quickForm.v} 
                onChange={e => setQuickForm({...quickForm, v: handleCurrencyInput(e.target.value)})} 
                placeholder="0,00" 
              />
            </div>
          </div>
          <div className="flex gap-4 pt-4">
            <button onClick={() => setIsQuickAddMode(false)} className="flex-1 h-14 border border-white/10 rounded-xl font-bold uppercase text-[10px] tracking-widest">CANCELAR</button>
            <button onClick={handleQuickProductSave} className="flex-1 btn-primary h-14 font-black italic uppercase tracking-widest">SALVAR PRODUTO</button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!editItem} onClose={closeEdit} title="EDITAR LANÇAMENTO">
        {editItem && (
          <form onSubmit={saveEdit} className="space-y-6">
            <div className="p-4 rounded-xl bg-luxury-orange/10 border border-luxury-orange/20"><p className="text-xl font-black italic uppercase text-white tracking-tighter">{editItem.produto_nome}</p></div>
            <div className="space-y-2">
              <label className="text-[10px] uppercase font-black text-white/20">Qtd Produzida</label>
              <input id="edit-produzido" type="number" autoFocus className="luxury-input w-full h-12 text-xl font-black italic" value={editForm.produzido} onChange={e => setEditForm({...editForm, produzido: e.target.value})} onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); document.getElementById('edit-data')?.focus(); } }} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <DateInput id="edit-data" value={editForm.data} onChange={v => setEditForm({...editForm, data: v})} onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); document.getElementById('edit-hora')?.focus(); } else if (e.key === 'ArrowUp') { e.preventDefault(); document.getElementById('edit-produzido')?.focus(); } }} />
              <TimeInput id="edit-hora" value={editForm.hora} onChange={v => setEditForm({...editForm, hora: v})} onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); document.getElementById('edit-save')?.focus(); } else if (e.key === 'ArrowUp') { e.preventDefault(); document.getElementById('edit-data')?.focus(); } }} />
            </div>
            <div className="flex gap-4 pt-4">
              <button id="edit-cancel" type="button" onClick={closeEdit} className="flex-1 h-14 border border-white/10 rounded-xl font-bold uppercase text-[10px] tracking-widest outline-none focus:bg-red-500/10" onKeyDown={e => { if (e.key === 'ArrowRight') { e.preventDefault(); document.getElementById('edit-save')?.focus(); } else if (e.key === 'ArrowUp') { e.preventDefault(); document.getElementById('edit-hora')?.focus(); } }}>CANCELAR</button>
              <button id="edit-save" type="submit" className="flex-1 btn-primary h-14 font-black italic uppercase tracking-widest outline-none focus:ring-4" onKeyDown={e => { if (e.key === 'ArrowLeft') { e.preventDefault(); document.getElementById('edit-cancel')?.focus(); } else if (e.key === 'ArrowUp') { e.preventDefault(); document.getElementById('edit-hora')?.focus(); } }}>SALVAR ALTERAÇÕES</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal isOpen={!!itemToDelete} onClose={() => setItemToDelete(null)} title="CONFIRMAR EXCLUSÃO">
        <div className="p-8 flex flex-col items-center text-center">
          <div className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center mb-6 border border-red-500/20 shadow-[0_0_30px_rgba(239,68,68,0.2)]"><AlertTriangle className="text-red-500" size={40} /></div>
          <h3 className="text-2xl font-black italic uppercase tracking-tighter mb-2">Atenção!</h3>
          <p className="text-white/60 font-bold mb-8 max-w-xs">Deseja realmente excluir <span className="text-white">"{itemToDelete?.produto_nome}"</span>?</p>
          <div className="flex gap-4 w-full">
            <button id="btn-cancel-delete" onClick={() => setItemToDelete(null)} className="flex-1 h-14 glass-card border-white/10 font-black italic uppercase tracking-widest text-[10px] outline-none focus:ring-4 rounded-xl" onKeyDown={e => { if (e.key === 'ArrowRight') { e.preventDefault(); document.getElementById('btn-confirm-delete')?.focus(); } }}>CANCELAR</button>
            <button id="btn-confirm-delete" autoFocus onClick={() => itemToDelete && deleteItem(itemToDelete.id)} className="flex-1 h-14 bg-red-600 rounded-xl font-black italic uppercase tracking-widest text-[10px] outline-none focus:ring-4" onKeyDown={e => { if (e.key === 'ArrowLeft') { e.preventDefault(); document.getElementById('btn-cancel-delete')?.focus(); } }}>EXCLUIR</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
