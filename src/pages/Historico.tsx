import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronDown, ChevronRight, Printer, Trash2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useDatabase } from "../hooks/useDatabase";
import Modal from "../components/Modal";
import { formatCurrency } from "../utils/currency";
import { buildHistoricoPrintText, getHistoricoActionMeta, getHistoricoActions, getHistoricoDeleteConfirmText, getNextHistoricoAction } from "./historicoActions";
import { buildHistoricoDeletePlan } from "./historicoDeleteFlow";
import { buildPaymentDetailLines, getPaymentMethodLabel, mapSalePaymentRows, type SalePaymentRow } from "./pdvPayments";

interface Venda {
  id: number;
  total_venda: number;
  metodo_pagamento: string;
  status?: string;
  data_venda: string;
  cliente_nome: string | null;
}

interface VendaItem {
  id: number;
  produto_id: number;
  lote_id: number | null;
  quantidade: number;
  preco_unitario: number;
  produto_nome: string;
}

interface PaymentTotals {
  dinheiro: number;
  pix: number;
  credito: number;
  debito: number;
  prazo: number;
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
  venda_id?: number;
  produto_nome: string;
  quantidade: number;
  valor_total: number;
}

interface HistoricoActionTarget {
  kind: "todas" | "prazo";
  id: number;
  titulo: string;
  descricao: string;
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
  misto:     { label: 'Misto',    color: 'text-luxury-orange' },
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
        className={`luxury-input w-full h-10 font-mono text-center tracking-wide outline-none transition-all ${
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
  const [vendaPayments, setVendaPayments] = useState<Record<number, SalePaymentRow[]>>({});
  const [expandedVendas, setExpandedVendas] = useState<Set<number>>(new Set());
  const [vendasPrazo, setVendasPrazo] = useState<VendaPrazoRow[]>([]);
  const [vendaPrazoItems, setVendaPrazoItems] = useState<Record<number, VendaPrazoItem[]>>({});
  const [expandedPrazo, setExpandedPrazo] = useState<Set<number>>(new Set());
  const [paymentTotals, setPaymentTotals] = useState<PaymentTotals>({ dinheiro: 0, pix: 0, credito: 0, debito: 0, prazo: 0 });
  const [activeTab, setActiveTab] = useState<'todas' | 'prazo'>('todas');
  const [actionTarget, setActionTarget] = useState<HistoricoActionTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HistoricoActionTarget | null>(null);
  const [actionBusy, setActionBusy] = useState<"print" | "delete" | null>(null);
  const [selectedAction, setSelectedAction] = useState<"imprimir" | "excluir">("imprimir");
  const [selectedDeleteAction, setSelectedDeleteAction] = useState<"cancelar" | "excluir">("excluir");
  const [cancelTarget, setCancelTarget] = useState<Venda | null>(null);
  const [selectedCancelSaleAction, setSelectedCancelSaleAction] = useState<"cancel" | "confirm">("confirm");
  const [printToast, setPrintToast] = useState<string | null>(null);
  const [printToastLeaving, setPrintToastLeaving] = useState(false);

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
  const printActionRef = useRef<HTMLButtonElement>(null);
  const deleteActionRef = useRef<HTMLButtonElement>(null);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  const confirmDeleteRef = useRef<HTMLButtonElement>(null);


  const load = useCallback(async () => {
    if (!db) return;
    const isoInicial = brToIso(dataInicial);
    const isoFinal = brToIso(dataFinal);
    if (!isoInicial || !isoFinal) return;

    const vs: Venda[] = await db.select(
      `SELECT
         v.id,
         v.total_venda,
         v.metodo_pagamento,
         v.status,
         v.data_venda,
         CASE
           WHEN LOWER(v.metodo_pagamento) = 'prazo' THEN (
             SELECT c.nome
             FROM vendas_prazo vp
             JOIN clientes c ON c.id = vp.cliente_id
             WHERE vp.data_venda = v.data_venda
               AND vp.total = v.total_venda
             ORDER BY vp.id DESC
             LIMIT 1
           )
           ELSE NULL
         END as cliente_nome
       FROM vendas v
       WHERE DATE(v.data_venda) >= $1 AND DATE(v.data_venda) <= $2
       ORDER BY v.data_venda DESC, v.id DESC`,
      [isoInicial, isoFinal]
    );
    setVendas(vs);
    setExpandedVendas(new Set());
    setVendaItems({});
    setVendaPayments({});

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

    const paymentRows: Array<{ metodo: string; total: number }> = await db.select(
      `SELECT LOWER(vp.metodo) as metodo, SUM(vp.valor) as total
       FROM venda_pagamentos vp
       JOIN vendas v ON v.id = vp.venda_id
       WHERE DATE(v.data_venda) >= $1 AND DATE(v.data_venda) <= $2
         AND COALESCE(LOWER(v.status), 'completa') = 'completa'
       GROUP BY LOWER(vp.metodo)`,
      [isoInicial, isoFinal],
    );

    const nextTotals: PaymentTotals = { dinheiro: 0, pix: 0, credito: 0, debito: 0, prazo: 0 };
    paymentRows.forEach((row) => {
      const key = row.metodo as keyof PaymentTotals;
      if (key in nextTotals) {
        nextTotals[key] = Number(row.total) || 0;
      }
    });
    setPaymentTotals(nextTotals);
  }, [db, dataInicial, dataFinal]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!printToast) {
      setPrintToastLeaving(false);
      return;
    }

    const exitTimer = window.setTimeout(() => {
      setPrintToastLeaving(true);
    }, 1500);

    const clearTimer = window.setTimeout(() => {
      setPrintToast(null);
      setPrintToastLeaving(false);
    }, 1800);

    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(clearTimer);
    };
  }, [printToast]);

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

  const loadVendaItemsForVenda = useCallback(async (id: number) => {
    if (!db) return [] as VendaItem[];
    if (vendaItems[id]) return vendaItems[id];

    const itens: any[] = await db.select(
      `SELECT vi.id, vi.produto_id, vi.lote_id, vi.quantidade, vi.preco_unitario, p.nome as produto_nome
       FROM venda_itens vi 
       LEFT JOIN produtos p ON p.id = vi.produto_id
       WHERE vi.venda_id = $1`, [id]
    );

    const processed = itens.map(i => ({
      ...i,
      produto_nome: i.produto_nome || `Produto #${i.produto_id} (Removido)`
    }));
    setVendaItems(prev => ({ ...prev, [id]: processed }));
    return processed as VendaItem[];
  }, [db, vendaItems]);

  const loadVendaPaymentsForVenda = useCallback(async (id: number) => {
    if (!db) return [] as SalePaymentRow[];
    if (vendaPayments[id]) return vendaPayments[id];

    const pagamentos: SalePaymentRow[] = await db.select(
      "SELECT id, venda_id, metodo, valor, ordem FROM venda_pagamentos WHERE venda_id = $1 ORDER BY ordem ASC, id ASC",
      [id],
    );
    setVendaPayments((prev) => ({ ...prev, [id]: pagamentos }));
    return pagamentos;
  }, [db, vendaPayments]);

  const loadVendaPrazoItemsForVenda = useCallback(async (id: number) => {
    if (!db) return [] as VendaPrazoItem[];
    if (vendaPrazoItems[id]) return vendaPrazoItems[id];

    const itens: VendaPrazoItem[] = await db.select("SELECT * FROM vendas_prazo_itens WHERE venda_id=$1", [id]);
    setVendaPrazoItems(prev => ({ ...prev, [id]: itens }));
    return itens;
  }, [db, vendaPrazoItems]);

  const toggleVenda = async (id: number) => {
    const isNowExpanded = !expandedVendas.has(id);
    
    setExpandedVendas(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

    if (isNowExpanded && (!vendaItems[id] || !vendaPayments[id])) {
      try {
        await Promise.all([
          loadVendaItemsForVenda(id),
          loadVendaPaymentsForVenda(id),
        ]);
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
        await loadVendaPrazoItemsForVenda(id);
      } catch (err) {
        console.error("Erro ao buscar itens a prazo:", err);
      }
    }
  };

  const openActions = (target: HistoricoActionTarget) => {
    setSelectedAction("imprimir");
    setActionTarget(target);
  };

  const closeActions = () => {
    if (actionBusy) return;
    setActionTarget(null);
  };

  useEffect(() => {
    if (!actionTarget) return;
    setSelectedAction("imprimir");
    setTimeout(() => printActionRef.current?.focus(), 0);
  }, [actionTarget]);

  const closeDeleteConfirm = () => {
    if (actionBusy) return;
    setDeleteTarget(null);
  };

  useEffect(() => {
    if (!deleteTarget) return;
    setSelectedDeleteAction("excluir");
    setTimeout(() => confirmDeleteRef.current?.focus(), 0);
  }, [deleteTarget]);

  const handlePrintVenda = async (target: HistoricoActionTarget) => {
    if (!db || actionBusy) return;
    setActionBusy("print");
    setActionTarget(null);
    setPrintToast("Imprimindo...");
    try {
      const configRows: any[] = await db.select(
        "SELECT impressao_largura_mm FROM configuracoes WHERE id = 1",
      );
      const paperWidth = Number(configRows[0]?.impressao_largura_mm) === 80 ? 80 : 58;

      if (target.kind === "todas") {
        const venda = vendas.find(v => v.id === target.id);
        if (!venda) return;
        const [itens, pagamentos] = await Promise.all([
          loadVendaItemsForVenda(target.id),
          loadVendaPaymentsForVenda(target.id),
        ]);
        const paymentEntries = mapSalePaymentRows(pagamentos);
        const paymentDetails = paymentEntries.length > 1 ? buildPaymentDetailLines(paymentEntries) : undefined;
        await invoke("imprimir_padrao_direto", {
          nome: `venda-${venda.id}.txt`,
          conteudo: buildHistoricoPrintText({
            titulo: `Venda #${venda.id}`,
            subtitulo: `Pagamento em ${getPaymentMethodLabel(venda.metodo_pagamento.toLowerCase())}`,
            dataVenda: isoToBr(venda.data_venda),
            total: venda.total_venda,
            itens: itens.map(item => ({
              descricao: item.produto_nome,
              quantidade: item.quantidade,
              valorUnitario: item.preco_unitario,
              valorTotal: item.quantidade * item.preco_unitario,
            })),
            paymentDetails,
          }, paperWidth),
          copias: 1,
          cortar: false,
        });
      } else {
        const venda = vendasPrazo.find(v => v.id === target.id);
        if (!venda) return;
        const itens = await loadVendaPrazoItemsForVenda(target.id);
        await invoke("imprimir_padrao_direto", {
          nome: `venda-prazo-${venda.id}.txt`,
          conteudo: buildHistoricoPrintText({
            titulo: `Venda a Prazo #${venda.id}`,
            subtitulo: venda.cliente_nome,
            dataVenda: isoToBr(venda.data_venda),
            total: venda.total,
            itens: itens.map(item => ({
              descricao: item.produto_nome,
              quantidade: item.quantidade,
              valorUnitario: item.quantidade > 0 ? item.valor_total / item.quantidade : item.valor_total,
              valorTotal: item.valor_total,
            })),
          }, paperWidth),
          copias: 1,
          cortar: false,
        });
      }
    } catch (err) {
      setPrintToast(null);
      console.error("Erro ao imprimir venda:", err);
      alert("Erro ao imprimir venda.");
    } finally {
      setActionBusy(null);
    }
  };

  const requestDeleteVenda = (target: HistoricoActionTarget) => {
    setActionTarget(null);
    setDeleteTarget(target);
  };

  useEffect(() => {
    if (!actionTarget || actionBusy) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        const next = getNextHistoricoAction(selectedAction, e.key);
        setSelectedAction(next);
        if (next === "imprimir") printActionRef.current?.focus();
        else deleteActionRef.current?.focus();
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (!actionTarget) return;
        if (selectedAction === "imprimir") handlePrintVenda(actionTarget);
        else requestDeleteVenda(actionTarget);
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [actionTarget, actionBusy, selectedAction, handlePrintVenda]);

  useEffect(() => {
    if (!deleteTarget || actionBusy) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        const next = selectedDeleteAction === "excluir" ? "cancelar" : "excluir";
        setSelectedDeleteAction(next);
        if (next === "cancelar") cancelDeleteRef.current?.focus();
        else confirmDeleteRef.current?.focus();
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (selectedDeleteAction === "cancelar") closeDeleteConfirm();
        else handleDeleteVenda();
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [deleteTarget, actionBusy, selectedDeleteAction]);

  useEffect(() => {
    if (!cancelTarget || actionBusy) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        setSelectedCancelSaleAction((prev) => (prev === "confirm" ? "cancel" : "confirm"));
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (selectedCancelSaleAction === "confirm") handleCancelVenda();
        else setCancelTarget(null);
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [cancelTarget, actionBusy, selectedCancelSaleAction]);

  const handleDeleteVenda = async () => {
    if (!db || !deleteTarget || actionBusy) return;
    setActionBusy("delete");
    try {
      const vendaAtual = deleteTarget.kind === "todas"
        ? vendas.find((v) => v.id === deleteTarget.id) ?? null
        : null;
      const deletePlan = buildHistoricoDeletePlan({
        targetKind: deleteTarget.kind,
        venda: vendaAtual,
        prazoId: deleteTarget.kind === "prazo" ? deleteTarget.id : null,
        prazoRows: vendasPrazo.map((v) => ({
          id: v.id,
          data_venda: v.data_venda,
          total: v.total,
        })),
      });

      if (deletePlan.deleteVendaId !== null) {
        const itens: Array<{ lote_id: number | null; quantidade: number }> = await db.select(
          "SELECT lote_id, quantidade FROM venda_itens WHERE venda_id = $1",
          [deletePlan.deleteVendaId]
        );

        for (const item of itens) {
          if (item.lote_id !== null) {
            await db.execute(
              `UPDATE lotes
               SET qtd_atual = qtd_atual + $1,
                   qtd_vendida = CASE
                     WHEN COALESCE(qtd_vendida, 0) >= $1 THEN qtd_vendida - $1
                     ELSE 0
                   END
               WHERE id = $2`,
              [item.quantidade, item.lote_id]
            );
          }
        }

        await db.execute("DELETE FROM venda_pagamentos WHERE venda_id = $1", [deletePlan.deleteVendaId]);
        await db.execute("DELETE FROM venda_itens WHERE venda_id = $1", [deletePlan.deleteVendaId]);
        await db.execute("DELETE FROM vendas WHERE id = $1", [deletePlan.deleteVendaId]);
      }

      for (const prazoId of deletePlan.deletePrazoIds) {
        await db.execute("DELETE FROM vendas_prazo_itens WHERE venda_id = $1", [prazoId]);
        await db.execute("DELETE FROM vendas_prazo WHERE id = $1", [prazoId]);
      }

      setDeleteTarget(null);
      await load();
    } catch (err) {
      console.error("Erro ao excluir venda:", err);
      alert(`Erro ao excluir venda: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActionBusy(null);
    }
  };

  const handleCancelVenda = async () => {
    if (!db || !cancelTarget || actionBusy) return;
    setActionBusy("delete");
    try {
      if (String(cancelTarget.status || "").toLowerCase() !== "cancelada") {
        const itens: Array<{ lote_id: number | null; quantidade: number }> = await db.select(
          "SELECT lote_id, quantidade FROM venda_itens WHERE venda_id = $1",
          [cancelTarget.id],
        );

        for (const item of itens) {
          if (item.lote_id !== null) {
            await db.execute(
              `UPDATE lotes
               SET qtd_atual = qtd_atual + $1,
                   qtd_vendida = CASE
                     WHEN COALESCE(qtd_vendida, 0) >= $1 THEN qtd_vendida - $1
                     ELSE 0
                   END
               WHERE id = $2`,
              [item.quantidade, item.lote_id],
            );
          }
        }

        const prazoPayments: Array<{ valor: number }> = await db.select(
          "SELECT valor FROM venda_pagamentos WHERE venda_id = $1 AND LOWER(metodo) = 'prazo' ORDER BY ordem ASC, id ASC",
          [cancelTarget.id],
        );

        await db.execute("UPDATE vendas SET status = 'cancelada' WHERE id = $1", [cancelTarget.id]);

        for (const payment of prazoPayments) {
          const prazoRows: Array<{ id: number }> = await db.select(
            "SELECT id FROM vendas_prazo WHERE data_venda = $1 AND total = $2 ORDER BY id DESC",
            [cancelTarget.data_venda, payment.valor],
          );

          for (const prazo of prazoRows) {
            await db.execute("DELETE FROM vendas_prazo_itens WHERE venda_id = $1", [prazo.id]);
            await db.execute("DELETE FROM vendas_prazo WHERE id = $1", [prazo.id]);
          }
        }
      }

      setCancelTarget(null);
      await load();
    } catch (err) {
      console.error("Erro ao cancelar venda:", err);
      alert(`Erro ao cancelar venda: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActionBusy(null);
    }
  };

  // ── Handler teclado ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (actionTarget || deleteTarget || cancelTarget) {
        return;
      }

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
        } else if (e.key === 'F1') {
          e.preventDefault(); e.stopPropagation();
          const venda = vendas[focusedRow];
          const meta = getHistoricoActionMeta('todas', venda.id);
          openActions({ kind: 'todas', id: venda.id, ...meta });
        } else if (e.key === 'F3') {
          e.preventDefault(); e.stopPropagation();
          const venda = vendas[focusedRow];
          if (String(venda.status || "").toLowerCase() !== "cancelada") {
            setSelectedCancelSaleAction("confirm");
            setCancelTarget(venda);
          }
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
        } else if (e.key === 'F1') {
          e.preventDefault(); e.stopPropagation();
          const venda = vendasPrazo[focusedRow];
          const meta = getHistoricoActionMeta('prazo', venda.id);
          openActions({ kind: 'prazo', id: venda.id, ...meta });
        } else if (e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation();
          togglePrazo(vendasPrazo[focusedRow].id);
        }
        return;
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [navZone, inputActive, focusedRow, activeTab, vendas, vendasPrazo, load, actionTarget, deleteTarget, cancelTarget]);

  // Totais
  const totalDinheiro = paymentTotals.dinheiro;
  const totalPix = paymentTotals.pix;
  const totalCredito = paymentTotals.credito;
  const totalDebito = paymentTotals.debito;
  const totalPrazo = paymentTotals.prazo;
  const totalGeral = totalDinheiro + totalPix + totalCredito + totalDebito + totalPrazo;

  const activeList = activeTab === 'todas' ? vendas : vendasPrazo;

  return (
    <div className="flex flex-col h-full gap-4">
      <h1 className="text-3xl font-black italic text-luxury-orange uppercase">Histórico de Vendas</h1>

      <div className="glass-card px-4 py-2 flex gap-6 text-xs font-bold text-white/40">
        <span><span className="text-luxury-orange">F1</span> = Ações</span>
        <span><span className="text-luxury-orange">ENTER</span> = Expandir</span>
        <span><span className="text-luxury-orange">↑↓</span> = Navegar</span>
        <span><span className="text-luxury-orange">F3</span> = Cancelar Venda</span>
        <span><span className="text-luxury-orange">ESC</span> = Sair</span>
      </div>

      {/* Filtro + Resumo */}
      <div className="glass-card px-4 py-3 flex flex-row gap-6 items-end">
        {/* Datas */}
        <div className="flex gap-3 shrink-0">
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

        {/* Resumo em Linha Única */}
        <div className="flex flex-1 gap-x-5 justify-end flex-nowrap min-w-0">
          {[
            { label: 'Dinheiro', value: totalDinheiro, color: 'text-green-400' },
            { label: 'PIX',      value: totalPix,      color: 'text-blue-400' },
            { label: 'Crédito',  value: totalCredito,  color: 'text-purple-400' },
            { label: 'Débito',   value: totalDebito,   color: 'text-purple-400' },
            { label: 'A Prazo',  value: totalPrazo,    color: 'text-luxury-orange' },
            { label: 'TOTAL',    value: totalGeral,    color: 'text-white' },
          ].map((t) => (
            <div key={t.label} className="text-left shrink-0">
              <p className="text-[10px] text-white/30 uppercase font-bold leading-tight">{t.label}</p>
              <p className={`text-base font-black ${t.color} leading-tight whitespace-nowrap`}>R$ {formatCurrency(t.value)}</p>
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
              <th className="px-4 py-3 w-24">ID</th>
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3">{activeTab === 'todas' ? 'Método' : 'Cliente'}</th>
              <th className="px-4 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {activeList.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-white/30 text-sm">Nenhuma venda no período</td></tr>
            )}
            {activeTab === 'todas' && vendas.map((v, i) => {
              const metodoLower = v.metodo_pagamento.toLowerCase();
              const meta = METODO_LABEL[metodoLower] || { 
                label: getPaymentMethodLabel(metodoLower), 
                color: 'text-white' 
              };
              const focused = navZone === 'lista-vendas' && focusedRow === i;
              const expanded = expandedVendas.has(v.id);
              const canceled = String(v.status || "").toLowerCase() === "cancelada";
              const metodoLabel = metodoLower === 'prazo' && v.cliente_nome
                ? `${meta.label} - ${v.cliente_nome}`
                : meta.label;
              return (
                <tr key={v.id} className="group">
                  <td colSpan={5} className="p-0">
                    <div
                      onClick={() => toggleVenda(v.id)}
                      ref={el => { rowRefs.current[i] = el; }}
                      tabIndex={-1}
                      onFocus={() => { setNavZone('lista-vendas'); setFocusedRow(i); }}
                      className={`flex items-center border-b border-white/5 transition-colors cursor-pointer outline-none px-0 ${
                        canceled
                          ? focused
                            ? 'bg-red-500/18 ring-1 ring-inset ring-red-500/35'
                            : 'bg-red-500/10 hover:bg-red-500/14'
                          : focused ? 'bg-luxury-orange/10 ring-1 ring-inset ring-luxury-orange/30' : 'hover:bg-white/5'
                      }`}
                    >
                      <div className="px-4 py-3 w-8 text-white/30 shrink-0">
                        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </div>
                      <div className={`px-4 py-3 font-mono text-xs w-24 shrink-0 ${canceled ? "text-red-200/80 line-through" : "text-white/45"}`}>#{v.id}</div>
                      <div className={`px-4 py-3 font-mono text-sm w-48 shrink-0 ${canceled ? "text-red-200/80 line-through" : "text-white/70"}`}>{isoToBr(v.data_venda)}</div>
                      <div className={`px-4 py-3 font-bold text-sm flex-1 ${canceled ? "text-red-200/90 line-through" : meta.color}`}>{metodoLabel}</div>
                      <div className={`px-4 py-3 text-right font-black w-32 shrink-0 ${canceled ? "text-red-100/90 line-through" : "text-white"}`}>R$ {formatCurrency(v.total_venda)}</div>
                    </div>
                    {expanded && (
                      <div className="bg-black/40 border-b border-white/5 overflow-hidden">
                        {!vendaItems[v.id] ? (
                          <div className="px-12 py-3 text-xs text-white/30 animate-pulse uppercase font-bold tracking-widest">Carregando itens...</div>
                        ) : vendaItems[v.id].length === 0 ? (
                          <div className="px-12 py-3 text-xs text-red-400/50 uppercase font-bold tracking-widest">Nenhum detalhe encontrado para esta venda.</div>
                        ) : (
                          <>
                            {vendaPayments[v.id] && vendaPayments[v.id].length > 1 && (
                              <div className="px-12 py-3 border-t border-white/5 bg-white/[0.02]">
                                <p className="text-[10px] uppercase tracking-[0.14em] font-bold text-white/30 mb-2">Pagamentos</p>
                                <div className="space-y-1">
                                  {buildPaymentDetailLines(mapSalePaymentRows(vendaPayments[v.id])).map((line) => (
                                    <div key={line} className="flex items-center justify-between text-sm font-bold text-white/80">
                                      <span>{line.split(":")[0]}</span>
                                      <span className="text-luxury-orange">{line.split(": ")[1]}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {vendaItems[v.id].map(item => (
                              <div key={item.id} className="flex items-center gap-3 px-12 py-2 border-t border-white/5 text-sm hover:bg-white/5 transition-colors">
                                <span className="flex-1 text-white/70 font-medium">
                                  <span className="text-luxury-orange font-bold mr-2">{item.quantidade}x</span>
                                  {item.produto_nome}
                                </span>
                                <div className="flex items-center gap-2 text-right font-mono">
                                  <span className="text-white/50 text-[11px] font-medium">
                                    R$ {formatCurrency(item.preco_unitario)}
                                  </span>
                                  <span className="text-white/10 text-xs">|</span>
                                  <span className="text-white font-black">
                                    R$ {formatCurrency(item.quantidade * item.preco_unitario)}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </>
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
                  <td colSpan={5} className="p-0">
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
                      <div className="px-4 py-3 font-mono text-xs text-white/45 w-24 shrink-0">#{v.id}</div>
                      <div className="px-4 py-3 font-mono text-sm text-white/70 w-48 shrink-0">{isoToBr(v.data_venda)}</div>
                      <div className="px-4 py-3 font-semibold text-luxury-orange flex-1">
                        A Prazo - {v.cliente_nome}
                      </div>
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
                              <span className="flex-1 text-white/70 font-medium">
                                <span className="text-luxury-orange font-bold mr-2">{item.quantidade}x</span>
                                {item.produto_nome}
                              </span>
                              <div className="flex items-center gap-2 text-right font-mono">
                                <span className="text-white/50 text-[11px] font-medium">
                                  R$ {formatCurrency(item.valor_total / item.quantidade)}
                                </span>
                                <span className="text-white/10 text-xs">|</span>
                                <span className="text-white font-black">
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

      <Modal
        isOpen={actionTarget !== null}
        onClose={closeActions}
        title={actionTarget?.titulo || "Acoes"}
      >
        <div className="space-y-3">
          {getHistoricoActions().map((action) => (
            <button
              key={action}
              ref={action === "imprimir" ? printActionRef : deleteActionRef}
              type="button"
              disabled={actionBusy !== null || !actionTarget}
              onFocus={() => setSelectedAction(action)}
              onClick={() => {
                if (!actionTarget) return;
                if (action === "imprimir") handlePrintVenda(actionTarget);
                if (action === "excluir") requestDeleteVenda(actionTarget);
              }}
              className={`w-full h-14 rounded-xl border text-left px-4 transition-all outline-none disabled:opacity-50 ${
                action === "imprimir"
                  ? selectedAction === "imprimir"
                    ? "bg-white/10 border-luxury-orange/50 ring-2 ring-luxury-orange/45"
                    : "bg-white/5 border-white/10 hover:bg-white/10"
                  : selectedAction === "excluir"
                    ? "bg-red-500/18 border-red-500/35 ring-2 ring-red-500/35"
                    : "bg-red-500/10 border-red-500/20 hover:bg-red-500/15"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  action === "imprimir" ? "bg-luxury-orange/15 text-luxury-orange" : "bg-red-500/15 text-red-400"
                }`}>
                  {action === "imprimir" ? <Printer size={18} /> : <Trash2 size={18} />}
                </div>
                <div>
                  <p className="font-bold uppercase text-sm text-white">
                    {action === "imprimir" ? "Imprimir" : "Excluir"}
                  </p>
                  <p className="text-xs text-white/40">
                    {action === "imprimir" ? "Abrir impressao desta venda" : "Apagar a venda selecionada"}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </Modal>

      <Modal
        isOpen={deleteTarget !== null}
        onClose={closeDeleteConfirm}
        title="Confirmar Exclusao"
      >
        <div className="space-y-6">
          <p className="text-sm text-white/70 leading-relaxed">
            {deleteTarget ? getHistoricoDeleteConfirmText(deleteTarget.descricao) : ""}
          </p>
          <div className="flex gap-3">
            <button
              ref={cancelDeleteRef}
              type="button"
              disabled={actionBusy !== null}
              onClick={closeDeleteConfirm}
              onFocus={() => setSelectedDeleteAction("cancelar")}
              className={`flex-1 h-12 rounded-xl border font-bold uppercase text-xs transition-all outline-none disabled:opacity-50 ${
                selectedDeleteAction === "cancelar"
                  ? "border-white/25 bg-white/10 text-white ring-2 ring-white/15"
                  : "border-white/10 text-white/60 hover:bg-white/5"
              }`}
            >
              Cancelar
            </button>
            <button
              ref={confirmDeleteRef}
              type="button"
              disabled={actionBusy !== null}
              onClick={handleDeleteVenda}
              onFocus={() => setSelectedDeleteAction("excluir")}
              className={`flex-1 h-12 rounded-xl text-white font-bold uppercase text-xs transition-all outline-none disabled:opacity-50 ${
                selectedDeleteAction === "excluir"
                  ? "bg-red-600 ring-2 ring-red-400/40"
                  : "bg-red-600/85 hover:bg-red-500"
              }`}
            >
              {actionBusy === "delete" ? "Excluindo..." : "Excluir"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={cancelTarget !== null}
        onClose={() => { if (!actionBusy) setCancelTarget(null); }}
        title="Cancelar Venda"
      >
        <div className="space-y-6">
          <p className="text-sm text-white/70 leading-relaxed">
            {cancelTarget ? `Deseja cancelar a venda #${cancelTarget.id} - R$ ${formatCurrency(cancelTarget.total_venda)}?` : ""}
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              disabled={actionBusy !== null}
              onClick={() => setCancelTarget(null)}
              onFocus={() => setSelectedCancelSaleAction("cancel")}
              className={`flex-1 h-12 rounded-xl border font-bold uppercase text-xs transition-all outline-none disabled:opacity-50 ${
                selectedCancelSaleAction === "cancel"
                  ? "border-white/25 bg-white/10 text-white ring-2 ring-white/15"
                  : "border-white/10 text-white/60 hover:bg-white/5"
              }`}
            >
              Nao
            </button>
            <button
              type="button"
              disabled={actionBusy !== null}
              onClick={handleCancelVenda}
              onFocus={() => setSelectedCancelSaleAction("confirm")}
              className={`flex-1 h-12 rounded-xl text-white font-bold uppercase text-xs transition-all outline-none disabled:opacity-50 ${
                selectedCancelSaleAction === "confirm"
                  ? "bg-red-600 ring-2 ring-red-400/40"
                  : "bg-red-600/85 hover:bg-red-500"
              }`}
            >
              {actionBusy === "delete" ? "Cancelando..." : "Sim"}
            </button>
          </div>
        </div>
      </Modal>

      {printToast && (
        <div className="fixed inset-x-0 bottom-6 z-[400] flex justify-center px-4 pointer-events-none">
          <div
            className={`min-w-[220px] max-w-sm rounded-xl border border-green-200/20 bg-green-500/18 px-4 py-3 text-center text-xs font-semibold uppercase tracking-[0.12em] text-white shadow-xl shadow-green-950/20 backdrop-blur-md transition-all duration-300 ${
              printToastLeaving ? "translate-y-8 opacity-0" : "translate-y-0 opacity-100"
            }`}
          >
            {printToast}
          </div>
        </div>
      )}
    </div>
  );
}
