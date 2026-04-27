import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useDatabase } from "../hooks/useDatabase";
import { formatCurrency } from "../utils/currency";

interface Venda {
  id: number;
  total_venda: number;
  metodo_pagamento: string;
  data_venda: string;
  cliente_nome: string | null;
}

interface VendaItem {
  id: number;
  produto_id: number;
  quantidade: number;
  preco_unitario: number;
  produto_nome: string;
}

interface VendaPrazoRow {
  id: number;
  cliente_id: number;
  data_venda: string;
  total: number;
  cliente_nome: string;
}

interface VendaPrazoItem {
  id: number;
  produto_nome: string;
  quantidade: number;
  valor_total: number;
}

function getTodayStr() {
  const now = new Date();
  return `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()}`;
}

function getFirstDayOfMonthStr() {
  const now = new Date();
  return `01/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()}`;
}

function brToIso(br: string): string {
  const [d, m, y] = br.split('/');
  if (!d || !m || !y) return '';
  return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
}

function isoToBr(iso: string): string {
  if (!iso) return '';
  // iso: 2024-04-27T14:30:00 or 2024-04-27
  const parts = iso.split('T');
  const datePart = parts[0];
  const timePart = parts[1] ? parts[1].slice(0, 5) : ''; // HH:MM
  const [y, m, d] = datePart.split('-');
  return timePart ? `${d}/${m}/${y} ${timePart}` : `${d}/${m}/${y}`;
}

function isValidBrDate(br: string): boolean {
  const parts = br.split('/');
  if (parts.length !== 3) return false;
  const [d, m, y] = parts.map(Number);
  if (!d || !m || !y || y < 1900 || y > 2100) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  return true;
}

const METODO_LABEL: Record<string, { label: string; color: string }> = {
  dinheiro:  { label: 'Dinheiro', color: 'text-green-400' },
  pix:       { label: 'Pix',      color: 'text-blue-400' },
  cartao:    { label: 'Cartão',   color: 'text-purple-400' },
  credito:   { label: 'Credito',  color: 'text-purple-400' },
  debito:    { label: 'Debito',   color: 'text-purple-400' },
  prazo:     { label: 'A Prazo',  color: 'text-luxury-orange' },
};

// ─── DateInput com navegação externa ────────────────────────────────────────
function DateInput({
  value, onChange, label, highlighted, inputActive,
  externalRef, onKeyDown: externalKeyDown,
}: {
  value: string; onChange: (v: string) => void; label: string;
  highlighted?: boolean; inputActive?: boolean;
  externalRef?: React.RefObject<HTMLInputElement | null>;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const localRef = useRef<HTMLInputElement>(null);
  const inputRef = externalRef ?? localRef;
  const [digits, setDigits] = useState(() => value.replace(/\//g,''));

  useEffect(() => {
    if (value && isValidBrDate(value)) {
      const raw = value.replace(/\//g,'');
      if (raw !== digits) setDigits(raw);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const digitToDisplayPos = (digitPos: number) => {
    if (digitPos <= 2) return digitPos;
    if (digitPos <= 4) return digitPos + 1;
    return digitPos + 2;
  };

  const displayValue = digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4, 8);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const posInDisplay = input.selectionStart ?? 0;
    
    // Converter posição do cursor no display para posição nos dígitos (0-7)
    let pos = 0;
    if (posInDisplay <= 2) pos = posInDisplay;
    else if (posInDisplay <= 5) pos = posInDisplay - 1;
    else pos = posInDisplay - 2;

    if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      externalKeyDown?.(e);
      return;
    }

    if (e.key === 'ArrowRight' && posInDisplay >= 10) { externalKeyDown?.(e); return; }
    if (e.key === 'ArrowLeft' && posInDisplay <= 0) { externalKeyDown?.(e); return; }

    if (!inputActive) { externalKeyDown?.(e); return; }

    if (/^\d$/.test(e.key)) {
      e.preventDefault();
      if (pos >= 8) return;
      const nd = digits.slice(0, pos) + e.key + digits.slice(pos + 1);
      setDigits(nd);
      const nextDigitPos = pos + 1;
      const nextDisplayPos = digitToDisplayPos(nextDigitPos);
      setTimeout(() => input.setSelectionRange(nextDisplayPos, nextDisplayPos), 0);
      
      const br = nd.slice(0, 2) + '/' + nd.slice(2, 4) + '/' + nd.slice(4, 8);
      if (isValidBrDate(br)) onChange(br);
      return;
    }

    if (e.key === 'Backspace') {
      e.preventDefault();
      if (posInDisplay === 0) return;
      
      // Se estiver logo após uma barra, apagar o dígito ANTERIOR à barra
      let digitToDeleteIdx = pos - 1;
      if (posInDisplay === 3 || posInDisplay === 6) {
         digitToDeleteIdx = pos - 1;
      }

      if (digitToDeleteIdx < 0) return;

      const nd = digits.slice(0, digitToDeleteIdx) + '_' + digits.slice(digitToDeleteIdx + 1);
      setDigits(nd);
      const prevDisplayPos = digitToDisplayPos(digitToDeleteIdx);
      setTimeout(() => input.setSelectionRange(prevDisplayPos, prevDisplayPos), 0);
      return;
    }

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') return;
    e.preventDefault();
  };

  return (
    <div>
      <label className="block text-xs uppercase tracking-widest text-white/40 font-bold mb-1">{label}</label>
      <input
        ref={inputRef}
        type="text"
        className={`luxury-input w-full h-10 font-mono text-center tracking-widest outline-none transition-all ${
          highlighted ? 'ring-1 ring-luxury-orange/60 border-luxury-orange/60' : ''
        } ${inputActive ? 'border-luxury-orange ring-2 ring-luxury-orange/50' : ''}`}
        value={displayValue}
        onChange={() => {}}
        onKeyDown={handleKeyDown}
        maxLength={10}
        readOnly={!inputActive}
      />
    </div>
  );
}

export default function Historico() {
  const { db } = useDatabase();
  const [dataInicial, setDataInicial] = useState(getTodayStr());
  const [dataFinal, setDataFinal] = useState(getTodayStr());
  const [vendas, setVendas] = useState<Venda[]>([]);
  const [vendaItems, setVendaItems] = useState<Record<number, VendaItem[]>>({});
  const [expandedVendas, setExpandedVendas] = useState<Set<number>>(new Set());
  const [vendasPrazo, setVendasPrazo] = useState<VendaPrazoRow[]>([]);
  const [vendaPrazoItems, setVendaPrazoItems] = useState<Record<number, VendaPrazoItem[]>>({});
  const [expandedPrazo, setExpandedPrazo] = useState<Set<number>>(new Set());
  const [activeTab, setActiveTab] = useState<'todas' | 'prazo'>('todas');

  // ── Navegação ──
  // Zonas: null | 'ini' | 'fim' | 'tab-vendas' | 'tab-prazo' | 'lista-vendas' | 'lista-prazo'
  type NavZone = null | 'ini' | 'fim' | 'tab-vendas' | 'tab-prazo' | 'lista-vendas' | 'lista-prazo';
  const [navZone, setNavZone] = useState<NavZone>(null);
  const [inputActive, setInputActive] = useState(false);
  const [focusedRow, setFocusedRow] = useState<number | null>(null); // index na lista atual

  const iniRef = useRef<HTMLInputElement>(null);
  const fimRef = useRef<HTMLInputElement>(null);
  const tabVendasRef = useRef<HTMLButtonElement>(null);
  const tabPrazoRef = useRef<HTMLButtonElement>(null);
  const rowRefs = useRef<(HTMLElement | null)[]>([]);


  const load = useCallback(async () => {
    if (!db) return;
    const isoInicial = brToIso(dataInicial);
    const isoFinal = brToIso(dataFinal);
    if (!isoInicial || !isoFinal) return;

    const vs: Venda[] = await db.select(
      `SELECT v.id, v.total_venda, v.metodo_pagamento, v.data_venda, NULL as cliente_nome
       FROM vendas v
       WHERE DATE(v.data_venda) >= $1 AND DATE(v.data_venda) <= $2
       ORDER BY v.data_venda DESC, v.id DESC`,
      [isoInicial, isoFinal]
    );
    setVendas(vs);
    setExpandedVendas(new Set());
    setVendaItems({});

    const vp: VendaPrazoRow[] = await db.select(
      `SELECT vp.id, vp.cliente_id, vp.data_venda, vp.total, c.nome as cliente_nome
       FROM vendas_prazo vp
       JOIN clientes c ON c.id = vp.cliente_id
       WHERE DATE(vp.data_venda) >= $1 AND DATE(vp.data_venda) <= $2
       ORDER BY vp.data_venda DESC, vp.id DESC`,
      [isoInicial, isoFinal]
    );
    setVendasPrazo(vp);
    setExpandedPrazo(new Set());
    setVendaPrazoItems({});
  }, [db, dataInicial, dataFinal]);

  useEffect(() => { load(); }, [load]);

  // Foca input ao ativar zona
  useEffect(() => {
    if (navZone === 'ini' && !inputActive) {
      setTimeout(() => { iniRef.current?.focus(); iniRef.current?.setSelectionRange(0,0); }, 0);
    } else if (navZone === 'fim' && !inputActive) {
      setTimeout(() => { fimRef.current?.focus(); fimRef.current?.setSelectionRange(0,0); }, 0);
    } else if (navZone === 'tab-vendas') {
      setTimeout(() => tabVendasRef.current?.focus(), 0);
    } else if (navZone === 'tab-prazo') {
      setTimeout(() => tabPrazoRef.current?.focus(), 0);
    }
  }, [navZone, inputActive]);

  // Foca linha ao mudar focusedRow
  useEffect(() => {
    if (focusedRow !== null && (navZone === 'lista-vendas' || navZone === 'lista-prazo')) {
      setTimeout(() => rowRefs.current[focusedRow]?.focus(), 0);
    }
  }, [focusedRow, navZone]);

  const toggleVenda = async (id: number) => {
    const isNowExpanded = !expandedVendas.has(id);
    
    setExpandedVendas(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

    if (isNowExpanded && !vendaItems[id]) {
      try {
        const itens: any[] = await db!.select(
          `SELECT vi.id, vi.produto_id, vi.quantidade, vi.preco_unitario, p.nome as produto_nome
           FROM venda_itens vi 
           LEFT JOIN produtos p ON p.id = vi.produto_id
           WHERE vi.venda_id = $1`, [id]
        );
        // Fallback for product name if product was deleted
        const processed = itens.map(i => ({
          ...i,
          produto_nome: i.produto_nome || `Produto #${i.produto_id} (Removido)`
        }));
        setVendaItems(prev => ({...prev, [id]: processed}));
      } catch (err) {
        console.error("Erro ao buscar itens da venda:", err);
      }
    }
  };

  const togglePrazo = async (id: number) => {
    const isNowExpanded = !expandedPrazo.has(id);

    setExpandedPrazo(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

    if (isNowExpanded && !vendaPrazoItems[id]) {
      try {
        const itens: VendaPrazoItem[] = await db!.select("SELECT * FROM vendas_prazo_itens WHERE venda_id=$1", [id]);
        setVendaPrazoItems(prev => ({...prev, [id]: itens}));
      } catch (err) {
        console.error("Erro ao buscar itens a prazo:", err);
      }
    }
  };

  // ── Handler teclado ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Se inputActive, apenas Enter/Esc saem do modo edição
      if (inputActive) {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation();
          setInputActive(false);
          iniRef.current?.blur(); fimRef.current?.blur();
          if (e.key === 'Enter') load();
        }
        return;
      }

      // ESC sai da zona atual
      if (e.key === 'Escape') {
        if (navZone !== null) {
          e.preventDefault(); e.stopPropagation();
          setNavZone(null); setFocusedRow(null);
          iniRef.current?.blur(); fimRef.current?.blur();
          tabVendasRef.current?.blur(); tabPrazoRef.current?.blur();
          (document.activeElement as HTMLElement)?.blur();
        }
        return;
      }

      // Enter sem zona → vai para ini
      if (e.key === 'Enter' && navZone === null) {
        e.preventDefault(); e.stopPropagation();
        setNavZone('ini');
        return;
      }

      // ── Zona: ini ──
      if (navZone === 'ini') {
        if (e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation();
          setInputActive(true);
          setTimeout(() => { iniRef.current?.focus(); iniRef.current?.setSelectionRange(0,0); }, 0);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault(); e.stopPropagation();
          setNavZone('fim');
        } else if (e.key === 'ArrowDown') {
          e.preventDefault(); e.stopPropagation();
          setNavZone(activeTab === 'todas' ? 'tab-vendas' : 'tab-prazo');
        }
        return;
      }

      // ── Zona: fim ──
      if (navZone === 'fim') {
        if (e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation();
          setInputActive(true);
          setTimeout(() => { fimRef.current?.focus(); fimRef.current?.setSelectionRange(0,0); }, 0);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault(); e.stopPropagation();
          setNavZone('ini');
        } else if (e.key === 'ArrowDown') {
          e.preventDefault(); e.stopPropagation();
          setNavZone(activeTab === 'todas' ? 'tab-vendas' : 'tab-prazo');
        }
        return;
      }

      // ── Zona: tab-vendas ──
      if (navZone === 'tab-vendas') {
        if (e.key === 'ArrowRight') {
          e.preventDefault(); e.stopPropagation();
          setNavZone('tab-prazo');
        } else if (e.key === 'ArrowUp') {
          e.preventDefault(); e.stopPropagation();
          setNavZone('ini');
        } else if (e.key === 'ArrowDown') {
          e.preventDefault(); e.stopPropagation();
          if (vendas.length > 0) { setNavZone('lista-vendas'); setFocusedRow(0); }
        } else if (e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation();
          setActiveTab('todas');
        }
        return;
      }

      // ── Zona: tab-prazo ──
      if (navZone === 'tab-prazo') {
        if (e.key === 'ArrowLeft') {
          e.preventDefault(); e.stopPropagation();
          setNavZone('tab-vendas');
        } else if (e.key === 'ArrowUp') {
          e.preventDefault(); e.stopPropagation();
          setNavZone('fim');
        } else if (e.key === 'ArrowDown') {
          e.preventDefault(); e.stopPropagation();
          if (vendasPrazo.length > 0) { setNavZone('lista-prazo'); setFocusedRow(0); }
        } else if (e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation();
          setActiveTab('prazo');
        }
        return;
      }

      // ── Zona: lista-vendas ──
      if (navZone === 'lista-vendas' && focusedRow !== null) {
        if (e.key === 'ArrowDown') {
          e.preventDefault(); e.stopPropagation();
          if (focusedRow < vendas.length - 1) setFocusedRow(focusedRow + 1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault(); e.stopPropagation();
          if (focusedRow > 0) setFocusedRow(focusedRow - 1);
          else { setNavZone('tab-vendas'); setFocusedRow(null); }
        } else if (e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation();
          toggleVenda(vendas[focusedRow].id);
        }
        return;
      }

      // ── Zona: lista-prazo ──
      if (navZone === 'lista-prazo' && focusedRow !== null) {
        if (e.key === 'ArrowDown') {
          e.preventDefault(); e.stopPropagation();
          if (focusedRow < vendasPrazo.length - 1) setFocusedRow(focusedRow + 1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault(); e.stopPropagation();
          if (focusedRow > 0) setFocusedRow(focusedRow - 1);
          else { setNavZone('tab-prazo'); setFocusedRow(null); }
        } else if (e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation();
          togglePrazo(vendasPrazo[focusedRow].id);
        }
        return;
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [navZone, inputActive, focusedRow, activeTab, vendas, vendasPrazo, load]);

  // Totais
  const totalDinheiro = vendas.filter(v => v.metodo_pagamento.toLowerCase() === 'dinheiro').reduce((a,v) => a+v.total_venda, 0);
  const totalPix      = vendas.filter(v => v.metodo_pagamento.toLowerCase() === 'pix').reduce((a,v) => a+v.total_venda, 0);
  const totalCartao   = vendas.filter(v => ['cartao', 'credito', 'debito'].includes(v.metodo_pagamento.toLowerCase())).reduce((a,v) => a+v.total_venda, 0);
  const totalPrazo    = vendasPrazo.reduce((a,v) => a+v.total, 0);
  const totalGeral    = totalDinheiro + totalPix + totalCartao + totalPrazo;

  const activeList = activeTab === 'todas' ? vendas : vendasPrazo;

  return (
    <div className="flex flex-col h-full gap-4">
      <h1 className="text-3xl font-black italic text-luxury-orange uppercase">Histórico de Vendas</h1>

      {/* Filtro + Resumo */}
      <div className="glass-card px-4 py-3 flex flex-col lg:flex-row gap-6 items-center">
        {/* Datas */}
        <div className="flex gap-4 shrink-0">
          <div className="w-40">
            <DateInput
              label="Data Inicial" value={dataInicial} onChange={setDataInicial}
              highlighted={navZone === 'ini' && !inputActive}
              inputActive={navZone === 'ini' && inputActive}
              externalRef={iniRef}
            />
          </div>
          <div className="w-40">
            <DateInput
              label="Data Final" value={dataFinal} onChange={setDataFinal}
              highlighted={navZone === 'fim' && !inputActive}
              inputActive={navZone === 'fim' && inputActive}
              externalRef={fimRef}
            />
          </div>
        </div>

        {/* Resumo em Grid */}
        <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-x-8 gap-y-3 w-full lg:w-auto">
          {[
            { label: 'Dinheiro', value: totalDinheiro, color: 'text-green-400' },
            { label: 'PIX',      value: totalPix,      color: 'text-blue-400' },
            { label: 'Cartão',   value: totalCartao,   color: 'text-purple-400' },
            { label: 'A Prazo',  value: totalPrazo,    color: 'text-luxury-orange' },
            { label: 'TOTAL',    value: totalGeral,    color: 'text-white' },
          ].map((t, idx, arr) => (
            <div key={t.label} className="text-left min-w-[100px]">
              <p className="text-[10px] text-white/30 uppercase font-bold leading-tight">{t.label}</p>
              <p className={`text-base font-black ${t.color} leading-tight`}>R$ {formatCurrency(t.value)}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        <button
          ref={tabVendasRef}
          tabIndex={-1}
          onClick={() => setActiveTab('todas')}
          onFocus={() => setNavZone('tab-vendas')}
          className={`px-4 py-2 rounded-xl text-sm font-bold uppercase tracking-wide transition-all outline-none ${
            activeTab === 'todas'
              ? 'bg-luxury-orange/10 border border-luxury-orange/30 text-luxury-orange'
              : 'text-white/40 border border-transparent hover:bg-white/5 hover:text-white'
          } ${navZone === 'tab-vendas' ? 'ring-1 ring-luxury-orange/50' : ''}`}
        >
          Vendas ({vendas.length})
        </button>
        <button
          ref={tabPrazoRef}
          tabIndex={-1}
          onClick={() => setActiveTab('prazo')}
          onFocus={() => setNavZone('tab-prazo')}
          className={`px-4 py-2 rounded-xl text-sm font-bold uppercase tracking-wide transition-all outline-none ${
            activeTab === 'prazo'
              ? 'bg-luxury-orange/10 border border-luxury-orange/30 text-luxury-orange'
              : 'text-white/40 border border-transparent hover:bg-white/5 hover:text-white'
          } ${navZone === 'tab-prazo' ? 'ring-1 ring-luxury-orange/50' : ''}`}
        >
          A Prazo ({vendasPrazo.length})
        </button>
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-auto glass-card">
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-luxury-dark-gray/90 backdrop-blur-sm">
            <tr className="border-b border-white/5 text-xs uppercase tracking-widest text-white/40">
              <th className="px-4 py-3 w-8"></th>
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3">{activeTab === 'todas' ? 'Método' : 'Cliente'}</th>
              <th className="px-4 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {activeList.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-white/30 text-sm">Nenhuma venda no período</td></tr>
            )}
            {activeTab === 'todas' && vendas.map((v, i) => {
              const metodoLower = v.metodo_pagamento.toLowerCase();
              const meta = METODO_LABEL[metodoLower] || { 
                label: v.metodo_pagamento.charAt(0).toUpperCase() + v.metodo_pagamento.slice(1).toLowerCase(), 
                color: 'text-white' 
              };
              const focused = navZone === 'lista-vendas' && focusedRow === i;
              const expanded = expandedVendas.has(v.id);
              return (
                <tr key={v.id} className="group">
                  <td colSpan={4} className="p-0">
                    <div
                      onClick={() => toggleVenda(v.id)}
                      ref={el => { rowRefs.current[i] = el; }}
                      tabIndex={-1}
                      onFocus={() => { setNavZone('lista-vendas'); setFocusedRow(i); }}
                      className={`flex items-center border-b border-white/5 transition-colors cursor-pointer outline-none px-0 ${
                        focused ? 'bg-luxury-orange/10 ring-1 ring-inset ring-luxury-orange/30' : 'hover:bg-white/5'
                      }`}
                    >
                      <div className="px-4 py-3 w-8 text-white/30 shrink-0">
                        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </div>
                      <div className="px-4 py-3 font-mono text-sm text-white/70 w-48 shrink-0">{isoToBr(v.data_venda)}</div>
                      <div className={`px-4 py-3 font-bold text-sm flex-1 ${meta.color}`}>{meta.label}</div>
                      <div className="px-4 py-3 text-right font-black text-white w-32 shrink-0">R$ {formatCurrency(v.total_venda)}</div>
                    </div>
                    {expanded && (
                      <div className="bg-black/40 border-b border-white/5 overflow-hidden">
                        {!vendaItems[v.id] ? (
                          <div className="px-12 py-3 text-xs text-white/30 animate-pulse uppercase font-bold tracking-widest">Carregando itens...</div>
                        ) : vendaItems[v.id].length === 0 ? (
                          <div className="px-12 py-3 text-xs text-red-400/50 uppercase font-bold tracking-widest">Nenhum detalhe encontrado para esta venda.</div>
                        ) : (
                          vendaItems[v.id].map(item => (
                            <div key={item.id} className="flex items-center gap-3 px-12 py-2 border-t border-white/5 text-sm hover:bg-white/5 transition-colors">
                              <span className="flex-1 text-white/70 font-medium">{item.produto_nome}</span>
                              <div className="flex items-center gap-4 text-right">
                                <span className="text-white/30 text-xs w-16">
                                  {item.quantidade} x R$ {formatCurrency(item.preco_unitario)}
                                </span>
                                <span className="text-white w-24 text-right font-black font-mono">
                                  R$ {formatCurrency(item.quantidade * item.preco_unitario)}
                                </span>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {activeTab === 'prazo' && vendasPrazo.map((v, i) => {
              const focused = navZone === 'lista-prazo' && focusedRow === i;
              const expanded = expandedPrazo.has(v.id);
              return (
                <tr key={v.id}>
                  <td colSpan={4} className="p-0">
                    <div
                      onClick={() => togglePrazo(v.id)}
                      ref={el => { rowRefs.current[i] = el; }}
                      tabIndex={-1}
                      onFocus={() => { setNavZone('lista-prazo'); setFocusedRow(i); }}
                      className={`flex items-center border-b border-white/5 transition-colors cursor-pointer outline-none ${
                        focused ? 'bg-luxury-orange/10 ring-1 ring-inset ring-luxury-orange/30' : 'hover:bg-white/5'
                      }`}
                    >
                      <div className="px-4 py-3 w-8 text-white/30 shrink-0">
                        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </div>
                      <div className="px-4 py-3 font-mono text-sm text-white/70 w-48 shrink-0">{isoToBr(v.data_venda)}</div>
                      <div className="px-4 py-3 font-semibold text-luxury-orange flex-1">{v.cliente_nome}</div>
                      <div className="px-4 py-3 text-right font-black text-white w-32 shrink-0">R$ {formatCurrency(v.total)}</div>
                    </div>
                    {expanded && (
                      <div className="bg-black/40 border-b border-white/5 overflow-hidden">
                        {!vendaPrazoItems[v.id] ? (
                          <div className="px-12 py-3 text-xs text-white/30 animate-pulse uppercase font-bold tracking-widest">Carregando itens...</div>
                        ) : vendaPrazoItems[v.id].length === 0 ? (
                          <div className="px-12 py-3 text-xs text-red-400/50 uppercase font-bold tracking-widest">Nenhum detalhe encontrado.</div>
                        ) : (
                          vendaPrazoItems[v.id].map(item => (
                            <div key={item.id} className="flex items-center gap-3 px-12 py-2 border-t border-white/5 text-sm hover:bg-white/5 transition-colors">
                              <span className="flex-1 text-white/70 font-medium">{item.produto_nome}</span>
                              <div className="flex items-center gap-4 text-right">
                                <span className="text-white/30 text-xs w-16">
                                  {item.quantidade} un
                                </span>
                                <span className="text-white w-24 text-right font-black font-mono">
                                  R$ {formatCurrency(item.valor_total)}
                                </span>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
