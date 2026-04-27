import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Plus, Search, Edit2, Trash2 } from "lucide-react";
import { useDatabase } from "../hooks/useDatabase";
import Modal from "../components/Modal";
import { handleCurrencyInput, parseCurrencyToNumber, formatCurrency } from "../utils/currency";
import { normalizeText } from "../utils/text";
import { cn } from "../utils/cn";

interface Produto {
  id: number;
  nome: string;
  codigo_barras: string | null;
  preco_venda: number;
  preco_custo: number;
  validade_padrao_dias: number;
  ativo: number;
}

export default function Produtos() {
  const { db, error: dbError } = useDatabase();
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [search, setSearch] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduto, setEditingProduto] = useState<Produto | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const newBtnRef = useRef<HTMLButtonElement>(null);
  // 'none' | 'list' | 'actions'
  const [rowMode, setRowMode] = useState<'none' | 'list' | 'actions'>('none');
  const [selectedRowIdx, setSelectedRowIdx] = useState(-1);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; nome: string } | null>(null);
  const [deleteConfirmRowIdx, setDeleteConfirmRowIdx] = useState<number>(-1);
  // Guarda qual linha e qual botão abriu o modal de edição
  const [editRowIdx, setEditRowIdx] = useState<number>(-1);
  
  const [form, setForm] = useState({
    nome: "",
    codigo_barras: "",
    preco_venda: "0,00",
    preco_custo: "0,00",
    margem: "0.60",
    ativo: 1
  });
  const [formError, setFormError] = useState<string | null>(null);
  const fNomeRef = useRef<HTMLInputElement>(null);
  const fCodRef = useRef<HTMLInputElement>(null);
  const fCustoRef = useRef<HTMLInputElement>(null);
  const fMargemRef = useRef<HTMLInputElement>(null);
  const fVendaRef = useRef<HTMLInputElement>(null);
  const fCancelarRef = useRef<HTMLButtonElement>(null);
  const fGravarRef = useRef<HTMLButtonElement>(null);

  // Layout do form (grid 2 cols):
  // [nome     ] [nome    ]
  // [cod      ] [custo   ]
  // [venda    ] [validade]
  // [cancelar ] [gravar  ]
  const formNav: Record<string, { up?: React.RefObject<any>; down?: React.RefObject<any>; left?: React.RefObject<any>; right?: React.RefObject<any> }> = {
    nome:     { down: fCodRef },
    cod:      { up: fNomeRef, right: fCustoRef, down: fMargemRef },
    custo:    { up: fNomeRef, left: fCodRef, down: fVendaRef },
    margem:   { up: fCodRef, right: fVendaRef, down: fCancelarRef },
    venda:    { up: fCustoRef, left: fMargemRef, down: fGravarRef },
    cancelar: { up: fMargemRef, right: fGravarRef },
    gravar:   { up: fVendaRef, left: fCancelarRef },
  };

  const handleFormNav = (e: React.KeyboardEvent, field: string) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const nav = formNav[field];
    if (!nav) return;
    const target = e.key === 'ArrowUp' ? nav.up : e.key === 'ArrowDown' ? nav.down : e.key === 'ArrowLeft' ? nav.left : nav.right;
    if (!target) return;
    e.preventDefault();
    target.current?.focus();
  };

  const loadProdutos = async () => {
    if (!db) return;
    try {
      const res: any[] = await db.select("SELECT * FROM produtos ORDER BY nome ASC");
      setProdutos(res);
    } catch (err) {
      console.error("Erro ao carregar produtos:", err);
    }
  };

  useEffect(() => {
    loadProdutos();
  }, [db]);

  // Quando o modal de edição fecha, restaura foco no botão de lapis (edit) da linha
  useEffect(() => {
    if (!isModalOpen && editRowIdx >= 0) {
      setRowMode('actions');
      setTimeout(() => {
        const btns = document.querySelectorAll(`[data-action-row="${editRowIdx}"]`);
        (btns[0] as HTMLElement)?.focus(); // lapis = primeiro botão
      }, 50);
    }
  }, [isModalOpen]);

  const filteredProdutos = produtos.filter(p => {
    if (!search) return true;
    const terms = search.split(/\s+/).filter(t => t.length > 0);
    const nomeMatch = terms.every(t => normalizeText(p.nome).includes(normalizeText(t)));
    const codigoMatch = p.codigo_barras?.includes(search) ?? false;
    return nomeMatch || codigoMatch;
  });

  useEffect(() => {
    const handleNav = (e: KeyboardEvent) => {
      if (deleteConfirm) {
        if (e.key === 'Escape') {
          e.stopImmediatePropagation();
          setDeleteConfirm(null);
          // Volta para actions mode com foco na lixeira
          setRowMode('actions');
          setTimeout(() => {
            const btns = document.querySelectorAll(`[data-action-row="${deleteConfirmRowIdx}"]`) as NodeListOf<HTMLElement>;
            btns[btns.length - 1]?.focus(); // lixeira = último botão
          }, 0);
        }
        return;
      }
      if (isModalOpen) return;

      const target = e.target as HTMLElement;
      const isSearch = target === searchRef.current;
      const isNewBtn = target === newBtnRef.current;

      // --- SEARCH BAR ---
      if (isSearch) {
        if (e.key === 'ArrowDown') {
          e.preventDefault(); e.stopImmediatePropagation();
          if (filteredProdutos.length > 0) { searchRef.current?.blur(); setRowMode('list'); setSelectedRowIdx(0); }
        } else if (e.key === 'ArrowUp') {
          e.preventDefault(); e.stopImmediatePropagation();
          newBtnRef.current?.focus();
        } else if (e.key === 'Escape') {
          e.preventDefault(); e.stopImmediatePropagation();
          setSearch('');
          searchRef.current?.blur();
          // Foca o item "PRODUTOS" no sidebar
          const link = document.querySelector('aside nav a[class*="bg-luxury-orange"]') as HTMLElement;
          link?.focus();
        }
        return;
      }

      // --- NOVO PRODUTO BUTTON ---
      if (isNewBtn) {
        if (e.key === 'ArrowDown') {
          e.preventDefault(); e.stopImmediatePropagation();
          searchRef.current?.focus();
        } else if (e.key === 'Escape') {
          e.preventDefault(); e.stopImmediatePropagation();
          searchRef.current?.focus();
        }
        // ArrowLeft: let Layout send to sidebar (natural)
        return;
      }

      // --- LIST MODE (row highlighted, no browser focus) ---
      if (rowMode === 'list') {
        if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape'].includes(e.key)) {
          e.preventDefault(); e.stopImmediatePropagation();
        }
        if (e.key === 'ArrowDown') {
          setSelectedRowIdx(p => Math.min(p + 1, filteredProdutos.length - 1));
        } else if (e.key === 'ArrowUp') {
          if (selectedRowIdx > 0) { setSelectedRowIdx(p => p - 1); }
          else { setRowMode('none'); setSelectedRowIdx(-1); searchRef.current?.focus(); }
        } else if (e.key === 'Enter') {
          e.preventDefault(); e.stopImmediatePropagation();
          setRowMode('actions');
          // Foca no lápis (primeiro botão = editar)
          setTimeout(() => {
            const btns = document.querySelectorAll(`[data-action-row="${selectedRowIdx}"]`);
            (btns[0] as HTMLElement)?.focus();
          }, 0);
        } else if (e.key === 'Escape') {
          e.preventDefault(); e.stopImmediatePropagation();
          setRowMode('none'); setSelectedRowIdx(-1);
          setTimeout(() => searchRef.current?.focus(), 0);
        }
        return;
      }

      // --- ACTIONS MODE (edit/delete focused) ---
      if (rowMode === 'actions') {
        if (e.key === 'Escape') {
          e.preventDefault(); e.stopImmediatePropagation();
          setRowMode('list');
          (document.activeElement as HTMLElement)?.blur();
        } else if (e.key === 'Enter') {
          e.preventDefault(); e.stopImmediatePropagation();
          // Apenas aciona o botão, sem resetar o estado da linha
          (document.activeElement as HTMLElement)?.click();
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault(); e.stopImmediatePropagation();
          const btns = Array.from(document.querySelectorAll(`[data-action-row="${selectedRowIdx}"]`)) as HTMLElement[];
          const idx = btns.indexOf(document.activeElement as HTMLElement);
          if (e.key === 'ArrowRight' && idx < btns.length - 1) btns[idx + 1].focus();
          else if (e.key === 'ArrowLeft' && idx > 0) btns[idx - 1].focus();
        }
        return;
      }

      // --- IDLE: Enter foca search, ESC vai para sidebar ---
      if (e.key === 'Enter') {
        e.preventDefault(); e.stopImmediatePropagation();
        searchRef.current?.focus();
        return;
      }
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        const link = document.querySelector('aside nav a[class*="bg-luxury-orange"]') as HTMLElement;
        link?.focus();
      }
    };

    // Capture phase: runs BEFORE Layout's bubble-phase handler
    window.addEventListener('keydown', handleNav, true);
    return () => window.removeEventListener('keydown', handleNav, true);
  }, [isModalOpen, deleteConfirm, deleteConfirmRowIdx, editRowIdx, rowMode, selectedRowIdx, produtos, search]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log("handleSave: Iniciando...", { db: !!db, dbError, form });
    if (!db) {
      setFormError(dbError || "Banco de dados não disponível ou inicializando...");
      return;
    }

    const cod = form.codigo_barras.trim();
    if (!cod) {
      setFormError("Código de barras é obrigatório.");
      return;
    }
    if (!/^\d+$/.test(cod)) {
      setFormError("Código de barras deve conter apenas números.");
      return;
    }
    if (cod.length > 13) {
      setFormError("Código de barras deve ter no máximo 13 dígitos.");
      return;
    }
    if (parseInt(cod) === 0) {
      setFormError("Código de barras não pode ser zero.");
      return;
    }

    try {
      const pVenda = parseCurrencyToNumber(form.preco_venda);
      const pCusto = parseCurrencyToNumber(form.preco_custo);
      const normalizedNome = normalizeText(form.nome);

      if (editingProduto) {
        await db.execute(
          "UPDATE produtos SET nome = $1, codigo_barras = $2, preco_venda = $3, preco_custo = $4, ativo = $5 WHERE id = $6",
          [normalizedNome, form.codigo_barras || null, pVenda, pCusto, form.ativo, editingProduto.id]
        );
      } else {
        await db.execute(
          "INSERT INTO produtos (nome, codigo_barras, preco_venda, preco_custo, ativo) VALUES ($1, $2, $3, $4, $5)",
          [normalizedNome, form.codigo_barras || null, pVenda, pCusto, form.ativo]
        );
      }
      console.log("handleSave: Sucesso!");
      setIsModalOpen(false);
      setEditingProduto(null);
      setFormError(null);
      setForm({ nome: "", codigo_barras: "", preco_venda: "0,00", preco_custo: "0,00", margem: "0.60", ativo: 1 });
      loadProdutos();
    } catch (err: any) {
      const msg = String(err?.message || err);
      console.error("handleSave: Erro detectado:", msg);
      if (msg.toLowerCase().includes("unique") || msg.toLowerCase().includes("unique constraint")) {
        setFormError("Este código de barras já pertence a outro produto.");
      } else {
        setFormError("Erro ao salvar: " + msg);
      }
    }
  };

  const handleEdit = (p: Produto, rowIdx?: number) => {
    setEditingProduto(p);
    if (rowIdx !== undefined) setEditRowIdx(rowIdx);
    setFormError(null);
    const margemCalculada = p.preco_venda > 0 ? (p.preco_custo / p.preco_venda).toFixed(2) : "0.60";
    setForm({
      nome: p.nome,
      codigo_barras: p.codigo_barras || "",
      preco_venda: formatCurrency(p.preco_venda),
      preco_custo: formatCurrency(p.preco_custo),
      margem: margemCalculada,
      ativo: p.ativo
    });
    setIsModalOpen(true);
  };

  const handleDelete = async () => {
    if (!db || !deleteConfirm) return;
    try {
      await db.execute("DELETE FROM produtos WHERE id = $1", [deleteConfirm.id]);
      setDeleteConfirm(null);
      loadProdutos();
    } catch (err) {
      setDeleteConfirm(null);
      setFormError("Erro ao excluir.");
    }
  };

  return (
    <div className="space-y-8 h-full flex flex-col">
      <header className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-black italic uppercase tracking-tighter text-white">Gerenciamento de <span className="text-luxury-orange">Produtos</span></h2>
          <p className="text-white/40">Controle financeiro e cadastral.</p>
        </div>
        <button
          ref={newBtnRef}
          onClick={() => {
            setEditingProduto(null);
            setForm({ nome: "", codigo_barras: "", preco_venda: "0,00", preco_custo: "0,00", margem: "0.60", ativo: 1 });
            setIsModalOpen(true);
          }}
          className="btn-primary flex items-center gap-2 px-6 h-12 focus:outline-none focus:ring-2 focus:ring-white/40"
        >
          <Plus size={20} />
          Novo Produto
        </button>
      </header>

      <div className="glass-card flex-1 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-white/5 bg-white/5 flex gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" size={18} />
            <input
              ref={searchRef}
              data-autofocus
              type="text"
              placeholder="Nome ou código de barras..."
              className="luxury-input w-full pl-12 h-11 focus:outline-none focus:ring-2 focus:ring-luxury-orange/50"
              value={search}
              onChange={e => setSearch(e.target.value)}
              spellCheck={false}
              autoCorrect="off"
              autoComplete="off"
              autoCapitalize="off"
            />
          </div>
        </div>

        {/* Invisible focus trap: keeps isMainFocused=true in Layout while navigating the list with keyboard */}
        <div tabIndex={rowMode === 'list' ? 0 : -1} className="sr-only" aria-hidden
          ref={el => { if (rowMode === 'list' && el && document.activeElement !== el) el.focus(); }} />

        <div className="flex-1 overflow-auto">
          <table className="w-full text-left">
            <thead className="text-white/20 text-xs uppercase tracking-widest border-b border-white/5 sticky top-0 bg-luxury-dark-gray z-10">
              <tr>
                <th className="px-6 py-4 font-medium">Produto</th>
                <th className="px-6 py-4 font-medium">Cód. Barras</th>
                <th className="px-6 py-4 font-medium text-red-500/60 uppercase whitespace-nowrap">Custo</th>
                <th className="px-6 py-4 font-medium text-luxury-orange uppercase whitespace-nowrap">Venda</th>
                <th className="px-6 py-4 font-medium text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filteredProdutos.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-20 text-center text-white/10 italic uppercase tracking-[0.2em]">
                    Nenhum produto localizado
                  </td>
                </tr>
              ) : (
                filteredProdutos.map((p, idx) => (
                  <tr 
                    key={p.id} 
                    className={`transition-colors group ${
                      selectedRowIdx === idx 
                        ? 'bg-luxury-orange/10 border-l-2 border-luxury-orange' 
                        : 'hover:bg-white/5'
                    }`}
                  >
                    <td className="px-6 py-4">
                      <button 
                        onClick={() => handleEdit(p)}
                        className="text-left focus:text-luxury-orange outline-none"
                      >
                        <p className="font-bold text-lg">{p.nome}</p>
                      </button>
                    </td>
                    <td className="px-6 py-4 text-white/40 font-mono text-sm">{p.codigo_barras || "-"}</td>
                    <td className="px-6 py-4 font-bold text-white/20 whitespace-nowrap">R$ {formatCurrency(p.preco_custo)}</td>
                    <td className="px-6 py-4 font-black text-luxury-orange whitespace-nowrap">R$ {formatCurrency(p.preco_venda)}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button 
                          data-action-row={idx}
                          tabIndex={-1}
                          onClick={() => handleEdit(p, idx)}
                          className="p-2 hover:bg-white/10 rounded-lg text-white/60 hover:text-white transition-colors outline-none focus:bg-luxury-orange/20 focus:text-luxury-orange focus:ring-1 focus:ring-luxury-orange"
                        >
                          <Edit2 size={18} />
                        </button>
                        <button 
                          data-action-row={idx}
                          tabIndex={-1}
                          onClick={() => { setDeleteConfirmRowIdx(idx); setDeleteConfirm({ id: p.id, nome: p.nome }); }}
                          className="p-2 hover:bg-red-500/10 rounded-lg text-white/60 hover:text-red-500 transition-colors outline-none focus:bg-red-500/20 focus:text-red-500 focus:ring-1 focus:ring-red-500"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)}
        title={editingProduto ? "Editar Produto" : "Novo Produto"}
      >
        <form 
          onSubmit={handleSave} 
          className="grid grid-cols-2 gap-6"
        >
          <div className="col-span-2">
            <label className="block text-xs uppercase tracking-widest text-white/40 font-bold mb-2">Nome do Produto</label>
            <input
              required
              autoFocus
              ref={fNomeRef}
              type="text"
              className="luxury-input w-full h-12"
              maxLength={40}
              value={form.nome}
              onChange={e => setForm({...form, nome: normalizeText(e.target.value.slice(0, 40))})}
              onKeyDown={e => handleFormNav(e, 'nome')}
            />
          </div>
          
          <div>
            <label className="block text-xs uppercase tracking-widest text-white/40 font-bold mb-2">Código de Barras</label>
            <input
              ref={fCodRef}
              type="text"
              className={`luxury-input w-full h-12 font-mono ${formError ? 'border-red-500/60 focus:ring-red-500/40' : ''}`}
              value={form.codigo_barras}
              onChange={e => { setFormError(null); const v = e.target.value.replace(/\D/g, '').slice(0, 13); setForm({...form, codigo_barras: v}); }}
              onKeyDown={e => handleFormNav(e, 'cod')}
            />
            {formError && (
              <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
                <span className="text-red-400 text-lg leading-none">⚠</span>
                <span className="text-red-400 text-xs font-semibold">{formError}</span>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs uppercase tracking-widest text-red-500/60 font-bold mb-2">Preço de Custo (R$)</label>
            <input
              required
              ref={fCustoRef}
              type="text"
              className="luxury-input w-full h-12 border-red-500/10 font-bold"
              value={form.preco_custo}
              onChange={e => {
                const formatted = handleCurrencyInput(e.target.value);
                const custo = parseCurrencyToNumber(formatted);
                const m = parseFloat(form.margem) || 0;
                let newVenda = form.preco_venda;
                if (custo > 0 && m > 0) {
                  newVenda = formatCurrency(custo / m);
                }
                setForm({...form, preco_custo: formatted, preco_venda: newVenda});
              }}
              onKeyDown={e => handleFormNav(e, 'custo')}
            />
          </div>

          <div>
            <label className="block text-xs uppercase tracking-widest text-white/40 font-bold mb-2">Margem (Ex: 0.6)</label>
            <input
              ref={fMargemRef}
              type="text"
              className={cn(
                "luxury-input w-full h-12 font-mono",
                (parseCurrencyToNumber(form.preco_venda) < parseCurrencyToNumber(form.preco_custo)) && "text-red-500 font-bold"
              )}
              placeholder="0.60"
              value={form.margem}
              onChange={e => {
                const val = e.target.value.replace(',', '.').replace(/[^\d.]/g, '');
                const m = parseFloat(val) || 0;
                const custo = parseCurrencyToNumber(form.preco_custo);
                let newVenda = form.preco_venda;
                if (m > 0 && custo > 0) {
                  newVenda = formatCurrency(custo / m);
                }
                setForm({...form, margem: val, preco_venda: newVenda});
              }}
              onKeyDown={e => handleFormNav(e, 'margem')}
            />
          </div>

          <div>
            <label className="block text-xs uppercase tracking-widest text-luxury-orange/60 font-bold mb-2">Preço de Venda (R$)</label>
            <input
              required
              ref={fVendaRef}
              type="text"
              className="luxury-input w-full h-12 border-luxury-orange/10 font-bold"
              value={form.preco_venda}
              onChange={e => {
                const formatted = handleCurrencyInput(e.target.value);
                const venda = parseCurrencyToNumber(formatted);
                const custo = parseCurrencyToNumber(form.preco_custo);
                let newMargem = form.margem;
                if (venda > 0 && custo > 0) {
                  newMargem = (custo / venda).toFixed(2);
                }
                setForm({...form, preco_venda: formatted, margem: newMargem});
              }}
              onKeyDown={e => handleFormNav(e, 'venda')}
            />
          </div>

          <div className="col-span-2 pt-6 border-t border-white/5 flex gap-4">
            <button
              ref={fCancelarRef}
              type="button"
              onClick={() => { setIsModalOpen(false); setFormError(null); }}
              className="flex-1 h-14 uppercase tracking-widest text-sm font-bold border border-white/10 rounded-xl hover:bg-red-500/10 hover:border-red-500/50 hover:text-red-500 focus:bg-red-500/10 focus:border-red-500/50 focus:text-red-500 outline-none transition-all"
              onKeyDown={e => handleFormNav(e, 'cancelar')}
            >
              Cancelar
            </button>
            <button
              ref={fGravarRef}
              type="submit"
              className={cn(
                "btn-primary flex-1 h-14 font-black italic tracking-widest uppercase transition-all duration-300",
                "focus:ring-4 focus:ring-white/20 focus:border-white/40 focus:shadow-[0_0_20px_rgba(255,107,0,0.3)] outline-none"
              )}
              onKeyDown={e => handleFormNav(e, 'gravar')}
            >
              Gravar Produto
            </button>
          </div>
        </form>
      </Modal>

      {deleteConfirm && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) setDeleteConfirm(null); }}>
          <div className="glass-card w-full max-w-sm p-8 border-red-500/20">
            <h3 className="text-xl font-black italic text-red-400 uppercase tracking-tighter mb-2">Excluir produto?</h3>
            <p className="text-white/50 text-sm mb-1">Você está prestes a excluir:</p>
            <p className="text-white font-bold mb-6 truncate">{deleteConfirm.nome}</p>
            <div className="space-y-2">
              <button
                autoFocus
                onClick={handleDelete}
                className={cn(
                  "w-full h-12 rounded-xl bg-red-600 hover:bg-red-700 text-white font-black uppercase tracking-widest text-sm transition-all duration-300",
                  "focus:ring-4 focus:ring-white/20 focus:border-white/40 focus:shadow-[0_0_20px_rgba(239,68,68,0.4)] outline-none"
                )}
              >
                Sim, excluir
              </button>
              <button
                onClick={() => {
                  setDeleteConfirm(null);
                  setRowMode('actions');
                  setTimeout(() => {
                    const btns = document.querySelectorAll(`[data-action-row="${deleteConfirmRowIdx}"]`) as NodeListOf<HTMLElement>;
                    btns[btns.length - 1]?.focus();
                  }, 0);
                }}
                className="w-full h-12 rounded-xl border border-white/10 hover:bg-red-500/10 hover:border-red-500/50 hover:text-red-500 focus:bg-red-500/10 focus:border-red-500/50 focus:text-red-500 outline-none transition-all font-bold uppercase text-xs tracking-widest"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
