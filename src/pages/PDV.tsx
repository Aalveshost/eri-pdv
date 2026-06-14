import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { CreditCard, Banknote, QrCode, X, Pencil, Trash2, Smartphone, Clock, Check, Printer, ChevronDown, ChevronUp } from "lucide-react";
import { useDatabase } from "../hooks/useDatabase";
import { useScanner } from "../hooks/useScanner";
import { invoke } from "@tauri-apps/api/core";
import { processarVendaFIFO } from "../utils/fifoEngine";
import { canUnlockWithAccessPassword, normalizeStoredAccessPassword, sanitizeAccessPassword } from "../utils/accessPassword";
import { normalizeText } from "../utils/text";
import { formatCurrency, parseCurrencyToNumber, handleCurrencyInput, handleWeightInput, finalizeWeightInput } from "../utils/currency";
import { buildHistoricoPrintText } from "./historicoActions";
import { getCashPaymentSummary } from "./pdvCashFlow";
import { formatDateBR, getCheckoutDefaultSelection, getPostFinalizeVendaState, getTodayDigits, getVendaSuccessToastTiming } from "./pdvFlow";
import {
  getAutoPrintCopies,
  getManualPrintCopies,
  getNextRecentSaleIndex,
  getPostFinalizePrintDefaultAction,
  getPostFinalizePrintNextAction,
  normalizePrintConfigRow,
  shouldOfferPostFinalizePrint,
  type PostFinalizePrintAction,
  type PrintConfig,
} from "./pdvPrintFlow";
import {
  buildPaymentDetailLines,
  getCheckoutPaymentsSummary,
  getPaymentMethodLabel,
  getResumoMetodoPagamento,
  mapSalePaymentRows,
  normalizePaymentEntries,
  type PaymentEntry,
  type PaymentMethod,
  type SalePaymentRow,
} from "./pdvPayments";
import { getReceiptPrintableWidthMm } from "./receiptPaperWidth";

// Module-level flag: set by Layout when user presses Enter on PDV sidebar link
// Checked on mount to decide whether to auto-focus the date input
export let pdvShouldFocusOnMount = false;
export function setPdvShouldFocusOnMount(val: boolean) { 
  pdvShouldFocusOnMount = val; 
}

// Interceptor: Layout calls this before navigating away from PDV.
// If PDV has items in cart, it shows the exit confirm modal and returns true (blocked).
// Returns false if navigation can proceed freely.
export let pdvNavigateAwayInterceptor: (() => boolean) | null = null;

// True while any PDV modal/popup is open — Layout skips its key handling
export let pdvModalOpen = false;

interface CartItem {
  id: number;
  cartId: number;
  nome: string;
  preco: number;
  quantidade: number;
}

interface RecentSale {
  id: number;
  total_venda: number;
  metodo_pagamento: string;
  status?: string;
  data_venda: string;
  cliente_nome: string | null;
}

interface RecentSaleItem {
  id: number;
  produto_nome: string;
  quantidade: number;
  preco_unitario: number;
}

interface PrintConfigWithStore extends PrintConfig {
  nomeLoja: string;
}

interface PostFinalizePrintJob {
  sale: Pick<RecentSale, "id" | "metodo_pagamento" | "cliente_nome" | "data_venda" | "total_venda">;
  itens: Array<{ descricao: string; quantidade: number; valorUnitario: number; valorTotal: number }>;
  config: PrintConfigWithStore;
  copies: number;
  payments?: PaymentEntry[];
}

const PAYMENT_LABELS: Record<string, string> = {
  dinheiro: "Dinheiro",
  pix: "PIX",
  credito: "Crédito",
  debito: "Débito",
  cartao: "Cartão",
  prazo: "A Prazo",
};

const PAYMENT_COLORS: Record<string, string> = {
  dinheiro: "text-green-400",
  pix: "text-blue-400",
  cartao: "text-purple-400",
  credito: "text-purple-400",
  debito: "text-purple-400",
  prazo: "text-luxury-orange",
  misto: "text-luxury-orange",
};

function formatSaleDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getSalePaymentLabel(sale: Pick<RecentSale, "metodo_pagamento" | "cliente_nome">) {
  const method = sale.metodo_pagamento.toLowerCase();
  const base = method === "misto" ? "Misto" : PAYMENT_LABELS[method] || `${sale.metodo_pagamento}`;
  if (method === "prazo" && sale.cliente_nome) {
    return `${base} - ${sale.cliente_nome}`;
  }
  return base;
}

function getSalePaymentColor(method: string) {
  return PAYMENT_COLORS[method.toLowerCase()] || "text-white";
}

export default function PDV() {
  const MASTER_PASSWORD = "1973";
  const { db } = useDatabase();
  const getTodayDigitsNow = () => getTodayDigits(new Date());

  const [stage, setStage] = useState<'date' | 'selling' | 'checkout'>('date');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState("");
  const [vendaDate, setVendaDate] = useState(formatDateBR(new Date()));
  const [dateDigits, setDateDigits] = useState(getTodayDigitsNow().padEnd(8, '_'));
  const [showQuantityModal, setShowQuantityModal] = useState(false);
  const [quantityInput, setQuantityInput] = useState("1");
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editingTotalInput, setEditingTotalInput] = useState("0,00");
  const [focusedZone, setFocusedZone] = useState<'products' | 'cart' | null>(null);
  const [focusedCartIndex, setFocusedCartIndex] = useState<number | null>(null);
  const [focusedCartAction, setFocusedCartAction] = useState<'edit' | 'delete' | null>(null);
  const [confirmDeleteIdx, setConfirmDeleteIdx] = useState<number | null>(null);
  const [focusedProductIndex, setFocusedProductIndex] = useState<number | null>(null);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [exitConfirmSelected, setExitConfirmSelected] = useState<'exit' | 'continue'>('exit');
  // checkout keyboard nav: payment cards + delete actions + footer buttons
  type CheckoutOption = 'prazo' | 'dinheiro' | 'pix' | 'credito' | 'debito';
  type CheckoutSelection = CheckoutOption | `delete:${PaymentMethod}` | 'back' | 'confirm';
  const [checkoutSelected, setCheckoutSelected] = useState<CheckoutSelection>('dinheiro');
  const [dateError, setDateError] = useState("");
  const [nextSaleId, setNextSaleId] = useState<number | null>(null);
  const [showClienteModal, setShowClienteModal] = useState(false);
  const [clientes, setClientes] = useState<{id:number;nome:string;telefone:string|null}[]>([]);
  const [clienteSearch, setClienteSearch] = useState('');
  const [clienteSelecionado, setClienteSelecionado] = useState<{id:number;nome:string}|null>(null);
  const [showPaymentConfirm, setShowPaymentConfirm] = useState(false);
  const [pendingPayment, setPendingPayment] = useState<{method: string, label: string} | null>(null);
  const [checkoutPayments, setCheckoutPayments] = useState<PaymentEntry[]>([]);
  const [showPaymentAmountModal, setShowPaymentAmountModal] = useState(false);
  const [paymentAmountMethod, setPaymentAmountMethod] = useState<PaymentMethod | null>(null);
  const [paymentAmountInput, setPaymentAmountInput] = useState("0,00");
  const [paymentAmountActionSelected, setPaymentAmountActionSelected] = useState<"confirm" | "cancel">("confirm");
  const [clienteFocusedIdx, setClienteFocusedIdx] = useState<number>(-1);
  const clienteListRef = useRef<HTMLDivElement>(null);
  const clienteItemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [vendaSuccess, setVendaSuccess] = useState<string|null>(null);
  const [vendaSuccessLeaving, setVendaSuccessLeaving] = useState(false);
  const [showRecentPrintModal, setShowRecentPrintModal] = useState(false);
  const [recentSales, setRecentSales] = useState<RecentSale[]>([]);
  const [recentSalesLoading, setRecentSalesLoading] = useState(false);
  const [selectedRecentSaleIndex, setSelectedRecentSaleIndex] = useState(0);
  const [recentPrintConfirmSale, setRecentPrintConfirmSale] = useState<RecentSale | null>(null);
  const [recentPrintSummaryExpanded, setRecentPrintSummaryExpanded] = useState(false);
  const [recentPrintPreviewItems, setRecentPrintPreviewItems] = useState<RecentSaleItem[]>([]);
  const [recentPrintPreviewLoading, setRecentPrintPreviewLoading] = useState(false);
  const [recentPrintActionSelected, setRecentPrintActionSelected] = useState<"print" | "cancel">("print");
  const [recentCancelPasswordSale, setRecentCancelPasswordSale] = useState<RecentSale | null>(null);
  const [recentCancelPasswordInput, setRecentCancelPasswordInput] = useState("");
  const [recentCancelPasswordError, setRecentCancelPasswordError] = useState(false);
  const [recentCancelConfirmSale, setRecentCancelConfirmSale] = useState<RecentSale | null>(null);
  const [recentCancelActionSelected, setRecentCancelActionSelected] = useState<"confirm" | "cancel">("confirm");
  const [printingRecentSale, setPrintingRecentSale] = useState(false);
  const recentPrintContentScrollRef = useRef<HTMLDivElement>(null);
  const recentCancelPasswordInputRef = useRef<HTMLInputElement>(null);
  const [postFinalizePrintJob, setPostFinalizePrintJob] = useState<PostFinalizePrintJob | null>(null);
  const [postFinalizePrintActionSelected, setPostFinalizePrintActionSelected] = useState<PostFinalizePrintAction>(getPostFinalizePrintDefaultAction());
  const [printingPostFinalizeSale, setPrintingPostFinalizeSale] = useState(false);
  const [recentPrintPreviewPayments, setRecentPrintPreviewPayments] = useState<SalePaymentRow[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const modalQuantityRef = useRef<HTMLInputElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const cartQuantityRef = useRef<HTMLInputElement>(null);
  const cartTotalRef = useRef<HTMLInputElement>(null);
  const cartFocusTrapRef = useRef<HTMLDivElement>(null);
  const productFocusTrapRef = useRef<HTMLDivElement>(null);
  const editingItemPrecoRef = useRef<number>(0);
  const editingItemIdRef = useRef<number | null>(null);
  const [lastAddedId, setLastAddedId] = useState<number | null>(null);
  const hasUserEnteredPDV = useRef(pdvShouldFocusOnMount);
  const focusedProductIndexRef = useRef<number | null>(null);

  const total = cart.reduce((acc, item) => acc + (item.preco * item.quantidade), 0);
  const checkoutSummary = getCheckoutPaymentsSummary(total, checkoutPayments);
  const checkoutPaymentLines = buildPaymentDetailLines(checkoutPayments);
  const amountModalTargetTotal = paymentAmountMethod === "dinheiro" ? checkoutSummary.restante || total : checkoutSummary.restante;
  const amountModalSummary = getCashPaymentSummary(
    amountModalTargetTotal,
    parseCurrencyToNumber(paymentAmountInput),
  );
  const currentMethodPayment = paymentAmountMethod
    ? checkoutPayments.find((entry) => entry.method === paymentAmountMethod) ?? null
    : null;

  const formatCurrencyInputValue = (value: number) => value.toFixed(2).replace(".", ",");

  const closePaymentAmountModal = () => {
    setShowPaymentAmountModal(false);
    setPaymentAmountMethod(null);
    setPaymentAmountInput("0,00");
    setPaymentAmountActionSelected("confirm");
  };

  const openPaymentAmountModal = (method: PaymentMethod) => {
    const existing = checkoutPayments.find((entry) => entry.method === method);
    const suggestedAmount = existing?.amount ?? (checkoutSummary.restante > 0 ? checkoutSummary.restante : total);
    setPaymentAmountMethod(method);
    setPaymentAmountInput(formatCurrencyInputValue(suggestedAmount));
    setPaymentAmountActionSelected("confirm");
    setShowPaymentAmountModal(true);
  };

  const confirmClienteSelection = () => {
    if (!clienteSelecionado) return;
    setShowClienteModal(false);
    if (stage === "checkout") {
      openPaymentAmountModal("prazo");
      return;
    }
    setShowPaymentConfirm(true);
  };

  const isCheckoutPaymentCard = (selection: CheckoutSelection): selection is CheckoutOption =>
    ["dinheiro", "pix", "credito", "debito", "prazo"].includes(selection);

  const isCheckoutDeleteSelection = (
    selection: CheckoutSelection,
  ): selection is `delete:${PaymentMethod}` => selection.startsWith("delete:");

  const getCheckoutDeleteSelection = (method: PaymentMethod): CheckoutSelection => `delete:${method}`;

  const clearCheckoutPayments = () => {
    setCheckoutPayments([]);
    setClienteSelecionado(null);
    setCheckoutSelected("prazo");
  };

  const removeCheckoutPayment = (method: PaymentMethod, nextSelection?: CheckoutSelection) => {
    const remaining = checkoutPayments.filter((entry) => entry.method !== method);
    const remainingNormalized = normalizePaymentEntries(remaining);

    setCheckoutPayments(remainingNormalized);
    if (method === "prazo") setClienteSelecionado(null);

    if (nextSelection) {
      setCheckoutSelected(nextSelection);
      return;
    }

    if (remainingNormalized.length > 0) {
      const currentIndex = checkoutPayments.findIndex((entry) => entry.method === method);
      const fallbackIndex = Math.min(
        currentIndex >= 0 ? currentIndex : 0,
        remainingNormalized.length - 1,
      );
      setCheckoutSelected(getCheckoutDeleteSelection(remainingNormalized[fallbackIndex].method));
      return;
    }

    setCheckoutSelected("prazo");
  };

  const quickFillCheckoutPayment = (method: Exclude<CheckoutOption, "prazo">) => {
    const existing = checkoutPayments.find((entry) => entry.method === method);
    const amountToLaunch = Math.round(((existing?.amount || 0) + checkoutSummary.restante) * 100) / 100;

    if (!Number.isFinite(amountToLaunch) || amountToLaunch <= 0) return;

    setCheckoutPayments((prev) => {
      const withoutMethod = prev.filter((entry) => entry.method !== method);
      return normalizePaymentEntries([
        ...withoutMethod,
        {
          method,
          amount: amountToLaunch,
        },
      ]);
    });
  };

  const confirmPaymentAmount = () => {
    if (!paymentAmountMethod) return;
    const parsedAmount = parseCurrencyToNumber(paymentAmountInput);
    const amount = Math.round(parsedAmount * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) return;
    if (paymentAmountMethod !== "dinheiro" && amount > checkoutSummary.restante + (currentMethodPayment?.amount || 0)) {
      return;
    }

    setCheckoutPayments((prev) => {
      const withoutMethod = prev.filter((entry) => entry.method !== paymentAmountMethod);
      return normalizePaymentEntries([
        ...withoutMethod,
        {
          method: paymentAmountMethod,
          amount,
        },
      ]);
    });
    closePaymentAmountModal();
  };

  const requestFinalizeCheckout = () => {
    if (!checkoutSummary.isComplete) return;
    const normalized = normalizePaymentEntries(checkoutPayments);
    const hasPrazo = normalized.some((entry) => entry.method === "prazo");
    if (hasPrazo && !clienteSelecionado) return;
    const resumo = getResumoMetodoPagamento(normalized);
    setPendingPayment({
      method: resumo,
      label: getPaymentMethodLabel(resumo),
    });
    setConfirmActionSelected("confirm");
    setShowPaymentConfirm(true);
  };

  const [confirmActionSelected, setConfirmActionSelected] = useState<'confirm' | 'cancel'>('confirm');
  const paymentAmountRef = useRef<HTMLInputElement>(null);

  const loadPrintConfig = async (): Promise<PrintConfigWithStore> => {
    if (!db) {
      return {
        nomeLoja: "Salgados Pro",
        autoPrintEnabled: false,
        autoPrintCopies: 1,
        cutPaperEnabled: false,
        paperWidth: 58,
      };
    }

    const rows: any[] = await db.select(
      "SELECT nome_loja, impressao_automatica, impressao_vias, impressao_corte, impressao_largura_mm FROM configuracoes WHERE id = 1",
    );
    const row = rows[0] || {};
    return {
      nomeLoja: row.nome_loja || "Salgados Pro",
      ...normalizePrintConfigRow(row),
    };
  };

  const buildSalePrintContent = (
    sale: Pick<RecentSale, "id" | "metodo_pagamento" | "cliente_nome" | "data_venda" | "total_venda">,
    itens: Array<{ descricao: string; quantidade: number; valorUnitario: number; valorTotal: number }>,
    config: PrintConfigWithStore,
    pagamentos: SalePaymentRow[] | PaymentEntry[] = [],
  ) => {
    const paymentEntries = pagamentos.length > 0 && "valor" in pagamentos[0]
      ? mapSalePaymentRows(pagamentos as SalePaymentRow[])
      : normalizePaymentEntries(pagamentos as PaymentEntry[]);
    const paymentDetails = paymentEntries.length > 1 ? buildPaymentDetailLines(paymentEntries) : undefined;
    return buildHistoricoPrintText({
      titulo: config.nomeLoja,
      subtitulo: `Venda #${sale.id}`,
      dataVenda: formatSaleDateTime(sale.data_venda),
      total: sale.total_venda,
      itens,
      paymentDetails,
    }, config.paperWidth);
  };

  const printSaleDirect = async (
    sale: Pick<RecentSale, "id" | "metodo_pagamento" | "cliente_nome" | "data_venda" | "total_venda">,
    itens: Array<{ descricao: string; quantidade: number; valorUnitario: number; valorTotal: number }>,
    config: PrintConfigWithStore,
    copies: number,
    pagamentos: SalePaymentRow[] | PaymentEntry[] = [],
  ) => {
    await invoke("imprimir_padrao_direto", {
      nome: `venda-${sale.id}.txt`,
      conteudo: buildSalePrintContent(sale, itens, config, pagamentos),
      copias: copies,
      cortar: config.cutPaperEnabled,
      larguraMm: getReceiptPrintableWidthMm(config.paperWidth),
    });
  };

  const loadRecentSales = async () => {
    if (!db) return [];
    const rows: RecentSale[] = await db.select(
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
       ORDER BY v.data_venda DESC, v.id DESC
       LIMIT 10`,
    );
    return rows;
  };

  const loadNextSaleId = async () => {
    if (!db) {
      setNextSaleId(null);
      return;
    }

    try {
      const rows: Array<{ next_id: number | null }> = await db.select(
        "SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM vendas",
      );
      setNextSaleId(Number(rows[0]?.next_id || 1));
    } catch (err) {
      console.error("Erro ao carregar proximo pedido:", err);
      setNextSaleId(null);
    }
  };

  const loadRecentSaleItems = async (saleId: number) => {
    if (!db) return [] as RecentSaleItem[];
    const rows: any[] = await db.select(
      `SELECT vi.id, vi.quantidade, vi.preco_unitario, p.nome as produto_nome
       FROM venda_itens vi
       LEFT JOIN produtos p ON p.id = vi.produto_id
       WHERE vi.venda_id = $1`,
      [saleId],
    );

    return rows.map((row) => ({
      id: row.id,
      quantidade: row.quantidade,
      preco_unitario: row.preco_unitario,
      produto_nome: row.produto_nome || `Produto removido`,
    }));
  };

  const loadSalePayments = async (saleId: number) => {
    if (!db) return [] as SalePaymentRow[];
    const rows: any[] = await db.select(
      "SELECT id, venda_id, metodo, valor, ordem FROM venda_pagamentos WHERE venda_id = $1 ORDER BY ordem ASC, id ASC",
      [saleId],
    );
    return rows as SalePaymentRow[];
  };

  const openRecentPrintModal = async () => {
    if (!db) return;
    setRecentSalesLoading(true);
    try {
      const rows = await loadRecentSales();
      setRecentSales(rows);
      setSelectedRecentSaleIndex(0);
      setRecentPrintConfirmSale(null);
      setRecentPrintSummaryExpanded(false);
      setShowRecentPrintModal(true);
    } catch (err) {
      console.error("Erro ao carregar últimas vendas:", err);
      alert("Erro ao carregar últimas vendas.");
    } finally {
      setRecentSalesLoading(false);
    }
  };

  const closeRecentPrintModal = () => {
    if (printingRecentSale) return;
    setRecentPrintConfirmSale(null);
    setRecentCancelPasswordSale(null);
    setRecentCancelPasswordInput("");
    setRecentCancelPasswordError(false);
    setRecentCancelConfirmSale(null);
    setRecentPrintSummaryExpanded(false);
    setRecentPrintPreviewItems([]);
    setRecentPrintPreviewPayments([]);
    setShowRecentPrintModal(false);
  };

  const performLogicalSaleCancellation = async (saleId: number) => {
    if (!db) return;

    const vendaRows: Array<{ id: number; status: string; data_venda: string; total_venda: number }> = await db.select(
      "SELECT id, status, data_venda, total_venda FROM vendas WHERE id = $1 LIMIT 1",
      [saleId],
    );
    const sale = vendaRows[0];
    if (!sale || String(sale.status || "").toLowerCase() === "cancelada") return;

    const itens: Array<{ lote_id: number | null; quantidade: number }> = await db.select(
      "SELECT lote_id, quantidade FROM venda_itens WHERE venda_id = $1",
      [saleId],
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
      [saleId],
    );

    await db.execute("UPDATE vendas SET status = 'cancelada' WHERE id = $1", [saleId]);

    for (const payment of prazoPayments) {
      const prazoRows: Array<{ id: number }> = await db.select(
        `SELECT id FROM vendas_prazo
         WHERE data_venda = $1 AND total = $2
         ORDER BY id DESC`,
        [sale.data_venda, payment.valor],
      );

      for (const prazo of prazoRows) {
        await db.execute("DELETE FROM vendas_prazo_itens WHERE venda_id = $1", [prazo.id]);
        await db.execute("DELETE FROM vendas_prazo WHERE id = $1", [prazo.id]);
      }
    }
  };

  const openRecentCancelPasswordModal = (sale: RecentSale) => {
    if (String(sale.status || "").toLowerCase() === "cancelada") return;
    setRecentCancelPasswordSale(sale);
    setRecentCancelPasswordInput("");
    setRecentCancelPasswordError(false);
    setTimeout(() => recentCancelPasswordInputRef.current?.focus(), 0);
  };

  const submitRecentCancelPassword = async () => {
    if (!db || !recentCancelPasswordSale) return;
    const rows: Array<{ senha: string | null }> = await db.select("SELECT senha FROM configuracoes WHERE id = 1");
    const expectedPassword = normalizeStoredAccessPassword(rows[0]?.senha);
    const input = sanitizeAccessPassword(recentCancelPasswordInput);

    if (!canUnlockWithAccessPassword(input, expectedPassword, MASTER_PASSWORD)) {
      setRecentCancelPasswordError(true);
      setTimeout(() => {
        recentCancelPasswordInputRef.current?.focus();
        const val = recentCancelPasswordInputRef.current?.value || "";
        recentCancelPasswordInputRef.current?.setSelectionRange(val.length, val.length);
      }, 0);
      return;
    }

    const sale = recentCancelPasswordSale;
    setRecentCancelPasswordSale(null);
    setRecentCancelPasswordInput("");
    setRecentCancelPasswordError(false);
    setRecentCancelConfirmSale(sale);
    setRecentCancelActionSelected("confirm");
  };

  const confirmRecentSaleCancel = async () => {
    if (!recentCancelConfirmSale) return;
    await performLogicalSaleCancellation(recentCancelConfirmSale.id);
    setRecentCancelConfirmSale(null);
    await openRecentPrintModal();
  };

  const closePostFinalizePrintModal = () => {
    if (printingPostFinalizeSale) return;
    setPostFinalizePrintJob(null);
    setPostFinalizePrintActionSelected(getPostFinalizePrintDefaultAction());
  };

  const openRecentPrintConfirm = async (sale: RecentSale) => {
    setRecentPrintConfirmSale(sale);
    setRecentPrintSummaryExpanded(false);
    setRecentPrintActionSelected("print");
    setRecentPrintPreviewLoading(true);
    try {
      const [itens, pagamentos] = await Promise.all([
        loadRecentSaleItems(sale.id),
        loadSalePayments(sale.id),
      ]);
      setRecentPrintPreviewItems(itens);
      setRecentPrintPreviewPayments(pagamentos);
    } catch (err) {
      console.error("Erro ao carregar itens da venda:", err);
      setRecentPrintPreviewItems([]);
      setRecentPrintPreviewPayments([]);
    } finally {
      setRecentPrintPreviewLoading(false);
    }
  };

  const handleManualPrintSale = async (sale: RecentSale) => {
    if (!db || printingRecentSale) return;
    setPrintingRecentSale(true);
    try {
      const [config, itens, pagamentos] = await Promise.all([
        loadPrintConfig(),
        loadRecentSaleItems(sale.id),
        loadSalePayments(sale.id),
      ]);

      await printSaleDirect(
        sale,
        itens.map((item) => ({
          descricao: item.produto_nome,
          quantidade: item.quantidade,
          valorUnitario: item.preco_unitario,
          valorTotal: item.quantidade * item.preco_unitario,
        })),
        config,
        getManualPrintCopies(),
        pagamentos,
      );

      setRecentPrintConfirmSale(null);
      setRecentPrintPreviewItems([]);
      setRecentPrintPreviewPayments([]);
      setShowRecentPrintModal(false);
    } catch (err) {
      console.error("Erro ao imprimir venda manualmente:", err);
      alert("Erro ao imprimir venda.");
    } finally {
      setPrintingRecentSale(false);
    }
  };

  const handlePostFinalizePrint = async () => {
    if (!postFinalizePrintJob || printingPostFinalizeSale) return;
    setPrintingPostFinalizeSale(true);
    try {
      await printSaleDirect(
        postFinalizePrintJob.sale,
        postFinalizePrintJob.itens,
        postFinalizePrintJob.config,
        postFinalizePrintJob.copies,
        postFinalizePrintJob.payments || [],
      );
      closePostFinalizePrintModal();
    } catch (err) {
      console.error("Erro ao imprimir venda após finalização:", err);
      alert("Venda concluída, mas a impressão falhou.");
    } finally {
      setPrintingPostFinalizeSale(false);
    }
  };

  // Search for products (only when in selling stage)
  useEffect(() => {
    if (stage !== 'selling') return;

    const loadProducts = async () => {
      if (!db || search.length === 0) {
        setProducts([]);
        return;
      }

      try {
        const terms = search.split(/\s+/).filter(t => t.length > 0);
        const results: any[] = await db.select(
          "SELECT id, nome, preco_venda, codigo_barras FROM produtos WHERE ativo = 1 ORDER BY nome"
        );

        // First try exact barcode match
        const barcodeMatch = results.find(p => p.codigo_barras === search);
        if (barcodeMatch) {
          setSelectedProduct(barcodeMatch);
          setQuantityInput("1");
          setShowQuantityModal(true);
          setSearch("");
          return;
        }

        // Then try name search
        const filtered = results.filter(product => {
          const productNameNormalized = normalizeText(product.nome);
          return terms.every(term => productNameNormalized.includes(normalizeText(term)));
        });

        if (filtered.length > 0) {
          setProducts(filtered);
          setFocusedProductIndex(0);
          focusedProductIndexRef.current = 0;
        } else {
          setProducts([]);
          setFocusedProductIndex(null);
          focusedProductIndexRef.current = null;
        }
      } catch (err) {
        console.error("Erro ao buscar produtos:", err);
      }
    };

    const timer = setTimeout(loadProducts, 200);
    return () => clearTimeout(timer);
  }, [db, search, stage]);

  // Barcode integration
  useScanner((code) => {
    if (stage === 'selling') {
      setSearch(code);
    }
  });

  const handleProductSelect = (product: any) => {
    setSelectedProduct(product);
    setQuantityInput("1"); // Reset to 1 for every new product
    setShowQuantityModal(true);
    setSearch("");
    setProducts([]);
  };

  const handleAddToCart = () => {
    const qty = parseFloat(quantityInput.replace(',', '.')) || 1;
    if (qty <= 0) return;

    setCart(prev => [
      ...prev,
      {
        id: selectedProduct.id,
        cartId: Date.now(),
        nome: selectedProduct.nome,
        preco: selectedProduct.preco_venda,
        quantidade: qty
      }
    ]);

    setLastAddedId(selectedProduct.id);
    setTimeout(() => setLastAddedId(null), 600);

    setShowQuantityModal(false);
    setQuantityInput("1");
    setSelectedProduct(null);
    searchInputRef.current?.focus();
  };

  // On mount: focus if user entered via Enter; reset module flag
  useEffect(() => {
    if (pdvShouldFocusOnMount) {
      hasUserEnteredPDV.current = true;
      if (stage === 'date' && dateInputRef.current) {
        dateInputRef.current.focus();
        dateInputRef.current.setSelectionRange(0, 0);
      }
      setPdvShouldFocusOnMount(false);
    }
    return () => { setPdvShouldFocusOnMount(false); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus date input whenever stage is 'date'
  useEffect(() => {
    if (stage === 'date' && dateInputRef.current) {
      setTimeout(() => {
        dateInputRef.current?.focus();
        dateInputRef.current?.setSelectionRange(0, 0);
      }, 50);
    }
    if (stage === 'selling') {
      setFocusedZone(null);
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }, [stage]);

  useEffect(() => {
    if (!db) return;
    if (stage !== "checkout" && stage !== "selling" && stage !== "date") return;
    void loadNextSaleId();
  }, [db, stage]);

  useEffect(() => {
    if (stage !== "checkout" && checkoutPayments.length > 0) {
      setCheckoutPayments([]);
    }
  }, [stage, checkoutPayments.length]);

  // Re-focus search input when exit confirm modal closes (ESC = continuar)
  useEffect(() => {
    if (!showExitConfirm && stage === 'selling') {
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }, [showExitConfirm, stage]);

  useEffect(() => {
    if (showPaymentAmountModal) {
      setTimeout(() => {
        paymentAmountRef.current?.focus();
        paymentAmountRef.current?.select();
      }, 50);
    }
  }, [showPaymentAmountModal]);

  useEffect(() => {
    if (!vendaSuccess) {
      setVendaSuccessLeaving(false);
      return;
    }

    const { visibleMs, exitMs } = getVendaSuccessToastTiming();
    setVendaSuccessLeaving(false);

    const exitTimer = window.setTimeout(() => {
      setVendaSuccessLeaving(true);
    }, visibleMs);

    const clearTimer = window.setTimeout(() => {
      setVendaSuccess(null);
      setVendaSuccessLeaving(false);
    }, visibleMs + exitMs);

    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(clearTimer);
    };
  }, [vendaSuccess]);

  useEffect(() => {
    if (!showRecentPrintModal) {
      setRecentPrintConfirmSale(null);
      setRecentCancelPasswordSale(null);
      setRecentCancelPasswordInput("");
      setRecentCancelPasswordError(false);
      setRecentCancelConfirmSale(null);
      setRecentPrintPreviewItems([]);
      setRecentPrintPreviewPayments([]);
      setRecentPrintPreviewLoading(false);
    }
  }, [showRecentPrintModal]);

  // Cliente modal keyboard navigation
  useEffect(() => {
    if (!showClienteModal) return;
    setClienteFocusedIdx(-1);
  }, [showClienteModal, clienteSearch]);

  useEffect(() => {
    if (!showClienteModal) return;
    const filtered = clientes.filter(c =>
      c.nome.includes(clienteSearch) || (c.telefone || '').includes(clienteSearch)
    );
    const handler = (e: KeyboardEvent) => {
      if (showPaymentConfirm) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault(); e.stopPropagation();
        setClienteFocusedIdx(prev => {
          const next = Math.min(prev + 1, filtered.length - 1);
          const item = filtered[next];
          if (item) setClienteSelecionado({ id: item.id, nome: item.nome });
          setTimeout(() => clienteItemRefs.current[next]?.scrollIntoView({ block: 'nearest' }), 0);
          return next;
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation();
        setClienteFocusedIdx(prev => {
          const next = Math.max(prev - 1, 0);
          const item = filtered[next];
          if (item) setClienteSelecionado({ id: item.id, nome: item.nome });
          setTimeout(() => clienteItemRefs.current[next]?.scrollIntoView({ block: 'nearest' }), 0);
          return next;
        });
      } else if (e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation();
        if (clienteSelecionado) confirmClienteSelection();
      } else if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        setShowClienteModal(false);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [showClienteModal, clienteSearch, clienteSelecionado, clientes, showPaymentConfirm, stage]);

  // Checkout keyboard navigation + sidebar lock
  useEffect(() => {
    if (stage !== 'checkout') return;

    // nav map for payment cards; delete actions and footer buttons are handled below
    const nav: Record<string, Partial<Record<string, string>>> = {
      dinheiro: { right: 'pix',      down: 'credito' },
      pix:      { left:  'dinheiro',  down: 'debito'  },
      credito:  { up: 'dinheiro',    right: 'debito', down: 'prazo' },
      debito:   { up: 'pix',         left:  'credito', down: 'prazo' },
      prazo:    { up: 'credito' },
    };

    const confirmSelected = (sel: CheckoutOption) => {
      if (sel === 'prazo') handleAPrazo();
      else openPaymentAmountModal(sel);
    };

    const handler = (e: KeyboardEvent) => {
      if (showClienteModal || showPaymentConfirm || showPaymentAmountModal) return;
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','Escape','Tab',' ','Backspace','Delete','F1'].includes(e.key)) {
        e.preventDefault(); e.stopPropagation();
      }
      if (e.key === 'F1') {
        requestFinalizeCheckout();
        return;
      }
      if (e.key === 'Escape') { setStage('selling'); return; }
      if (e.key === ' ' && isCheckoutPaymentCard(checkoutSelected) && checkoutSelected !== 'prazo') {
        quickFillCheckoutPayment(checkoutSelected);
        return;
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && isCheckoutPaymentCard(checkoutSelected)) {
        const methodToRemove = checkoutSelected === 'prazo' ? 'prazo' : checkoutSelected;
        if (checkoutPayments.some((entry) => entry.method === methodToRemove)) {
          removeCheckoutPayment(methodToRemove, checkoutSelected);
        }
        return;
      }
      if (e.key === 'Enter') {
        if (isCheckoutPaymentCard(checkoutSelected)) {
          confirmSelected(checkoutSelected);
          return;
        }

        if (isCheckoutDeleteSelection(checkoutSelected)) {
          removeCheckoutPayment(checkoutSelected.replace('delete:', '') as PaymentMethod);
          return;
        }

        if (checkoutSelected === 'back') {
          setStage('selling');
          return;
        }

        if (checkoutSelected === 'confirm') {
          requestFinalizeCheckout();
        }
        return;
      }
      const moves: Record<string, string> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Tab: 'down' };
      const dir = moves[e.key];
      if (!dir) return;

      const deleteMethods = checkoutPayments.map((entry) => entry.method);

      setCheckoutSelected(prev => {
        if (isCheckoutPaymentCard(prev)) {
          if (prev === 'prazo' && dir === 'down') {
            return deleteMethods.length > 0 ? getCheckoutDeleteSelection(deleteMethods[0]) : 'confirm';
          }
          const next = nav[prev]?.[dir];
          return (next as CheckoutSelection) ?? prev;
        }

        if (isCheckoutDeleteSelection(prev)) {
          const currentMethod = prev.replace('delete:', '') as PaymentMethod;
          const currentIndex = deleteMethods.findIndex((method) => method === currentMethod);

          if (dir === 'up') {
            if (currentIndex <= 0) return 'prazo';
            return getCheckoutDeleteSelection(deleteMethods[currentIndex - 1]);
          }

          if (dir === 'down' || dir === 'tab') {
            if (currentIndex >= 0 && currentIndex < deleteMethods.length - 1) {
              return getCheckoutDeleteSelection(deleteMethods[currentIndex + 1]);
            }
            return 'confirm';
          }

          return prev;
        }

        if (prev === 'confirm' || prev === 'back') {
          if (dir === 'left' || dir === 'right') {
            return prev === 'confirm' ? 'back' : 'confirm';
          }

          if (dir === 'up') {
            return deleteMethods.length > 0
              ? getCheckoutDeleteSelection(deleteMethods[deleteMethods.length - 1])
              : 'prazo';
          }

          return prev;
        }

        return prev;
      });
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [stage, showClienteModal, showPaymentConfirm, showPaymentAmountModal, checkoutPayments, checkoutSelected, checkoutSummary.restante]);

  // Keep pdvModalOpen in sync so Layout can skip its key handling while a modal is open
  useEffect(() => {
    pdvModalOpen =
      showExitConfirm ||
      showQuantityModal ||
      showClienteModal ||
      showPaymentConfirm ||
      showPaymentAmountModal ||
      showRecentPrintModal ||
      postFinalizePrintJob !== null ||
      stage === 'checkout';
    return () => { pdvModalOpen = false; };
  }, [showExitConfirm, showQuantityModal, showClienteModal, showPaymentConfirm, showPaymentAmountModal, showRecentPrintModal, postFinalizePrintJob, stage]);

  useEffect(() => {
    if (!showRecentPrintModal) return;

    const handler = (e: KeyboardEvent) => {
      if (printingRecentSale) return;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "Escape", "Tab", "F3"].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
      }

      if (recentCancelPasswordSale) {
        if (e.key === "Escape") {
          setRecentCancelPasswordSale(null);
          setRecentCancelPasswordInput("");
          setRecentCancelPasswordError(false);
          return;
        }
        if (e.key === "Enter") {
          void submitRecentCancelPassword();
        }
        return;
      }

      if (recentCancelConfirmSale) {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          setRecentCancelActionSelected((prev) => (prev === "confirm" ? "cancel" : "confirm"));
          return;
        }
        if (e.key === "Escape") {
          setRecentCancelConfirmSale(null);
          return;
        }
        if (e.key === "Enter") {
          if (recentCancelActionSelected === "confirm") void confirmRecentSaleCancel();
          else setRecentCancelConfirmSale(null);
        }
        return;
      }

      if (recentPrintConfirmSale) {
        if (e.key === "Tab") {
          setRecentPrintSummaryExpanded((prev) => !prev);
          return;
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          recentPrintContentScrollRef.current?.scrollBy({
            top: e.key === "ArrowDown" ? 96 : -96,
            behavior: "smooth",
          });
          return;
        }
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          setRecentPrintActionSelected((prev) => (prev === "print" ? "cancel" : "print"));
          return;
        }
        if (e.key === "Escape") {
          setRecentPrintConfirmSale(null);
          setRecentPrintSummaryExpanded(false);
          setRecentPrintPreviewItems([]);
          setRecentPrintPreviewPayments([]);
          return;
        }
        if (e.key === "F3") {
          setRecentPrintConfirmSale(null);
          setRecentPrintSummaryExpanded(false);
          setRecentPrintPreviewItems([]);
          setRecentPrintPreviewPayments([]);
          return;
        }
        if (e.key === "Enter") {
          if (recentPrintActionSelected === "print") {
            handleManualPrintSale(recentPrintConfirmSale);
          } else {
            setRecentPrintConfirmSale(null);
            setRecentPrintSummaryExpanded(false);
            setRecentPrintPreviewItems([]);
            setRecentPrintPreviewPayments([]);
          }
        }
        return;
      }

      if (e.key === "Escape") {
        closeRecentPrintModal();
        return;
      }

      if (e.key === "F3") {
        const selectedSale = recentSales[selectedRecentSaleIndex];
        if (selectedSale) openRecentCancelPasswordModal(selectedSale);
        return;
      }

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        setSelectedRecentSaleIndex((prev) => getNextRecentSaleIndex(prev, e.key as "ArrowUp" | "ArrowDown", recentSales.length));
        return;
      }

      if (e.key === "Enter" && recentSales[selectedRecentSaleIndex]) {
        void handleManualPrintSale(recentSales[selectedRecentSaleIndex]);
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [showRecentPrintModal, recentPrintConfirmSale, recentSales, selectedRecentSaleIndex, printingRecentSale, recentPrintActionSelected, recentCancelPasswordSale, recentCancelConfirmSale, recentCancelActionSelected, recentCancelPasswordInput]);

  useEffect(() => {
    if (!postFinalizePrintJob) return;

    const handler = (e: KeyboardEvent) => {
      if (printingPostFinalizeSale) return;

      if (["ArrowLeft", "ArrowRight", "Enter", "Escape"].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
      }

      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        setPostFinalizePrintActionSelected((prev) =>
          getPostFinalizePrintNextAction(prev, e.key as "ArrowLeft" | "ArrowRight"),
        );
        return;
      }

      if (e.key === "Escape") {
        closePostFinalizePrintModal();
        return;
      }

      if (e.key === "Enter") {
        if (postFinalizePrintActionSelected === "print") {
          void handlePostFinalizePrint();
        } else {
          closePostFinalizePrintModal();
        }
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [postFinalizePrintJob, postFinalizePrintActionSelected, printingPostFinalizeSale]);

  // Register navigate-away interceptor so Layout can ask PDV before leaving
  useEffect(() => {
    pdvNavigateAwayInterceptor = () => {
      if (cart.length > 0) {
        setExitConfirmSelected('exit');
        setShowExitConfirm(true);
        return true; // blocked
      }
      return false; // free to navigate
    };
    return () => { pdvNavigateAwayInterceptor = null; };
  }, [cart.length]);

  useEffect(() => {
    if (!showExitConfirm) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setExitConfirmSelected(prev => prev === 'exit' ? 'continue' : 'exit');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (exitConfirmSelected === 'exit') {
          setCart([]);
          setShowExitConfirm(false);
          setStage('date');
          setTimeout(() => {
            const activeSidebarLink = document.querySelector('aside nav a[class*="bg-luxury-orange"]') as HTMLElement;
            activeSidebarLink?.focus();
          }, 0);
        } else {
          setShowExitConfirm(false);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setShowExitConfirm(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showExitConfirm, exitConfirmSelected]);

  // Focus quantity modal: Select everything for quick replacement
  useEffect(() => {
    if (showQuantityModal && modalQuantityRef.current) {
      setTimeout(() => {
        modalQuantityRef.current?.focus();
        modalQuantityRef.current?.select();
      }, 50);
    }
  }, [showQuantityModal]);

  // Keep ref in sync so capture-phase handler always sees latest value
  useEffect(() => { editingItemIdRef.current = editingItemId; }, [editingItemId]);

  useEffect(() => {
    if (editingItemId && cartQuantityRef.current) {
      setTimeout(() => {
        cartQuantityRef.current?.focus();
        cartQuantityRef.current?.select();
      }, 50);
    }
  }, [editingItemId]);

  useEffect(() => {
    if (editingItemId === null) return;
    const q = parseFloat(quantityInput) || 0;
    setEditingTotalInput(formatCurrency(editingItemPrecoRef.current * q));
  }, [quantityInput, editingItemId]);

  const handleQuantityKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setShowQuantityModal(false);
      setQuantityInput("1");
      setSelectedProduct(null);
      setTimeout(() => searchInputRef.current?.focus(), 0);
      return;
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (document.activeElement === modalQuantityRef.current) {
        addBtnRef.current?.focus();
      } else {
        modalQuantityRef.current?.focus();
      }
      return;
    }
  };

  // Keyboard navigation (selling stage only)
  useEffect(() => {
    if (stage !== 'selling') return;

    const enterProductZone = () => {
      setFocusedZone('products');
      setTimeout(() => productFocusTrapRef.current?.focus(), 0);
    };
    const enterCartZone = () => {
      setFocusedZone('cart');
      setFocusedCartIndex(prev => prev ?? 0);
      setFocusedCartAction(null);
      setTimeout(() => cartFocusTrapRef.current?.focus(), 0);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (showQuantityModal || showExitConfirm || showClienteModal || showRecentPrintModal || editingItemIdRef.current !== null) {
        return;
      }

      // F1: finalizar venda
      if (e.key === 'F1') {
        e.preventDefault(); e.stopPropagation();
        if (cart.length > 0) {
          setCheckoutSelected(getCheckoutDefaultSelection('dinheiro'));
          setStage('checkout');
        }
        return;
      }

      if (e.key === 'F2') {
        e.preventDefault(); e.stopPropagation();
        void openRecentPrintModal();
        return;
      }

      // Tab: toggle zone (prevent default browser tab)
      if (e.key === 'Tab') {
        e.preventDefault(); e.stopPropagation();
        if (focusedZone === 'cart') enterProductZone();
        else if (cart.length > 0) enterCartZone();
        return;
      }

      // ESC: global exit or clear
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        if (showExitConfirm) { setShowExitConfirm(false); return; }
        if (focusedZone === 'cart') {
          enterProductZone(); return;
        }
        if (focusedProductIndexRef.current !== null) {
          focusedProductIndexRef.current = null;
          setFocusedProductIndex(null);
          return;
        }
        if (search.length > 0) { setSearch(''); setProducts([]); return; }
        if (cart.length > 0) { setExitConfirmSelected('exit'); setShowExitConfirm(true); }
        else { setStage('date'); }
        return;
      }

      // ── CART ZONE ──────────────────────────────────────────────────
      if (focusedZone === 'cart') {
        e.stopPropagation();

        // Confirm delete sub-mode
        if (confirmDeleteIdx !== null) {
          e.preventDefault();
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { /* visual only */ }
          else if (e.key === 'Enter' || e.key === 'y' || e.key === 'Y') {
            setCart(prev => prev.filter((_, i) => i !== confirmDeleteIdx));
            setFocusedCartIndex(null); setFocusedCartAction(null); setConfirmDeleteIdx(null);
            enterProductZone();
          } else if (e.key === 'Escape' || e.key === 'n' || e.key === 'N') {
            setConfirmDeleteIdx(null); setFocusedCartAction(null);
            setTimeout(() => cartFocusTrapRef.current?.focus(), 0);
          }
          return;
        }

        // Action buttons sub-mode (Editar / Remover)
        if (focusedCartIndex !== null && focusedCartAction !== null) {
          e.preventDefault();
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            setFocusedCartAction(prev => prev === 'edit' ? 'delete' : 'edit');
          } else if (e.key === 'Enter') {
            if (focusedCartAction === 'edit') {
              const item = cart[focusedCartIndex];
              editingItemPrecoRef.current = Number(item.preco);
              setEditingItemId(item.id);
              setQuantityInput(item.quantidade.toFixed(3));
              setEditingTotalInput(formatCurrency(Number(item.preco) * Number(item.quantidade)));
              setFocusedCartAction(null);
            } else {
              setConfirmDeleteIdx(focusedCartIndex);
            }
          } else if (e.key === 'Escape') {
            setFocusedCartAction(null);
            setTimeout(() => cartFocusTrapRef.current?.focus(), 0);
          }
          return;
        }

        // Cart item list navigation
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setFocusedCartIndex(prev => prev !== null ? Math.min(prev + 1, cart.length - 1) : 0);
          setTimeout(() => cartFocusTrapRef.current?.focus(), 0);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setFocusedCartIndex(prev => prev !== null && prev > 0 ? prev - 1 : 0);
          setTimeout(() => cartFocusTrapRef.current?.focus(), 0);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          setFocusedCartAction('edit');
        } else if (e.key === 'ArrowLeft' || e.key === 'Tab') {
          e.preventDefault();
          enterProductZone();
        } else if (e.key === 'ArrowRight') {
          e.preventDefault(); // no-op, already rightmost
        }
        return;
      }

      // ── PRODUCT ZONE (or no zone yet) ─────────────────────────────
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        if (document.activeElement === searchInputRef.current) return;
        if (e.key === 'ArrowRight' && cart.length > 0) {
          e.preventDefault(); e.stopPropagation(); enterCartZone();
        }
        return;
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation();
        if (focusedZone !== 'products') setFocusedZone('products');
        const curIdx = focusedProductIndexRef.current;
        if (e.key === 'ArrowDown') {
          if (products.length > 0) {
            const next = curIdx === null ? 0 : Math.min(curIdx + 1, products.length - 1);
            focusedProductIndexRef.current = next;
            setFocusedProductIndex(next);
          }
        } else {
          if (curIdx === null || curIdx === 0) {
            focusedProductIndexRef.current = null;
            setFocusedProductIndex(null);
          } else {
            const prev = curIdx - 1;
            focusedProductIndexRef.current = prev;
            setFocusedProductIndex(prev);
          }
        }
        return;
      }

      if (e.key === 'Enter' && focusedProductIndexRef.current !== null && products[focusedProductIndexRef.current]) {
        e.preventDefault(); e.stopPropagation();
        handleProductSelect(products[focusedProductIndexRef.current]);
        focusedProductIndexRef.current = null;
        setFocusedProductIndex(null);
        return;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && document.activeElement === productFocusTrapRef.current) {
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [stage, cart, cart.length, showExitConfirm, products, focusedProductIndex, search, focusedCartIndex, focusedCartAction, confirmDeleteIdx, focusedZone, editingItemId, showQuantityModal, showClienteModal, showRecentPrintModal, postFinalizePrintJob]);

  const loadClientes = async () => {
    if (!db) return;
    const rows: any[] = await db.select("SELECT id, nome, telefone FROM clientes ORDER BY nome");
    setClientes(rows);
  };

  const handleFinalize = async (metodo: string, clienteId?: number, pagamentosInput?: PaymentEntry[]) => {
    if (!db || cart.length === 0) return;

    try {
      const pagamentosNormalizados = normalizePaymentEntries(
        pagamentosInput && pagamentosInput.length > 0
          ? pagamentosInput
          : [{ method: metodo as PaymentMethod, amount: total }],
      );
      const prazoPayment = pagamentosNormalizados.find((payment) => payment.method === "prazo");
      if (prazoPayment && !clienteId) {
        alert("Selecione o cliente para registrar a parte a prazo.");
        return;
      }
      const metodoResumo = getResumoMetodoPagamento(pagamentosNormalizados);
      const cartSnapshot = cart.map((item) => ({
        descricao: item.nome,
        quantidade: item.quantidade,
        valorUnitario: item.preco,
        valorTotal: item.preco * item.quantidade,
      }));
      const clienteNomeSnapshot = clienteSelecionado?.nome || null;
      const itemsInput = cart.map(i => ({
        produtoId: i.id,
        quantidade: i.quantidade,
        precoUnitario: i.preco
      }));
      const todayBr = formatDateBR(new Date());
      let isoDate = vendaDate.split('/').reverse().join('-');
      let vendaId: number | null = null;
      
      if (vendaDate === todayBr) {
        const now = new Date();
        const timeStr = `T${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
        isoDate += timeStr;
      } else {
        isoDate += "T00:00:00";
      }

      if (prazoPayment && clienteId) {
        const vendaResult = await processarVendaFIFO(db, itemsInput, metodoResumo, total, isoDate, pagamentosNormalizados);
        vendaId = Number(vendaResult.vendaId);
        const res = await db.execute(
          "INSERT INTO vendas_prazo (cliente_id, data_venda, total) VALUES ($1, $2, $3)",
          [clienteId, isoDate, prazoPayment.amount]
        );
        const vendaIdPrazo = res.lastInsertId;
        const proporcaoPrazo = total > 0 ? prazoPayment.amount / total : 0;
        let totalPrazoDistribuido = 0;
        for (const [index, item] of cart.entries()) {
          const valorTotalItem = item.preco * item.quantidade;
          const valorPrazoItem = index === cart.length - 1
            ? Number((prazoPayment.amount - totalPrazoDistribuido).toFixed(2))
            : Number((valorTotalItem * proporcaoPrazo).toFixed(2));
          totalPrazoDistribuido += valorPrazoItem;
          await db.execute(
            "INSERT INTO vendas_prazo_itens (venda_id, produto_nome, quantidade, valor_total) VALUES ($1, $2, $3, $4)",
            [vendaIdPrazo, item.nome, item.quantidade, valorPrazoItem]
          );
        }
      } else {
        const vendaResult = await processarVendaFIFO(db, itemsInput, metodoResumo, total, isoDate, pagamentosNormalizados);
        vendaId = Number(vendaResult.vendaId);
      }

      closePaymentAmountModal();
      const postFinalizeState = getPostFinalizeVendaState(new Date());
      setShowPaymentConfirm(false);
      setPendingPayment(null);
      setCheckoutPayments([]);
      setCart([]);
      setClienteSelecionado(null);
      setShowClienteModal(false);
      setVendaSuccess(prazoPayment ? `Venda registrada${pagamentosNormalizados.length > 1 ? " em misto" : " a prazo"} para ${clienteSelecionado?.nome}!` : 'Venda realizada com sucesso!');
      setVendaDate(postFinalizeState.vendaDate);
      setDateDigits(postFinalizeState.dateDigits);
      setNextSaleId(vendaId !== null ? vendaId + 1 : nextSaleId);
      setStage(postFinalizeState.stage);

      if (vendaId !== null) {
        try {
          const config = await loadPrintConfig();
          const copies = getAutoPrintCopies(config);
          if (copies > 0 && shouldOfferPostFinalizePrint(config)) {
            setPostFinalizePrintActionSelected(getPostFinalizePrintDefaultAction());
            setPostFinalizePrintJob({
              sale: {
                id: vendaId,
                metodo_pagamento: metodoResumo,
                cliente_nome: clienteNomeSnapshot,
                data_venda: isoDate,
                total_venda: total,
              },
              itens: cartSnapshot,
              config,
              copies,
              payments: pagamentosNormalizados,
            });
          }
        } catch (printErr) {
          console.error("Erro ao preparar impressão automática:", printErr);
          alert("Venda concluída, mas não foi possível preparar a impressão.");
        }
      }
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error("Erro ao processar venda:", msg);
      alert("Erro ao processar venda: " + msg);
    }
  };

  const handleAPrazo = async () => {
    await loadClientes();
    setClienteSearch('');
    if (!checkoutPayments.find((entry) => entry.method === "prazo")) {
      setClienteSelecionado(null);
    }
    setPendingPayment({ method: 'prazo', label: 'A Prazo' });
    setShowClienteModal(true);
  };

  const vendaSuccessToast = vendaSuccess && createPortal(
    <div className="fixed inset-x-0 bottom-6 z-[400] flex justify-center px-4 pointer-events-none">
      <div
        className={`min-w-[220px] max-w-sm rounded-xl border border-green-200/20 bg-green-500/18 px-4 py-3 text-center text-xs font-semibold uppercase tracking-[0.12em] text-white shadow-xl shadow-green-950/20 backdrop-blur-md transition-all duration-300 ${
          vendaSuccessLeaving
            ? "translate-y-8 opacity-0"
            : "translate-y-0 opacity-100"
        }`}
      >
        {vendaSuccess}
      </div>
    </div>,
    document.body
  );

  if (stage === 'date') {
    const isValidDate = (day: number, month: number, year: number): boolean => {
      if (day < 1 || day > 31 || month < 1 || month > 12) return false;
      const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      if ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) daysInMonth[1] = 29;
      return day <= daysInMonth[month - 1];
    };

    const displayValue = dateDigits.slice(0, 2) + '/' + dateDigits.slice(2, 4) + '/' + dateDigits.slice(4, 8);
    const displayToDigitPos = (displayPos: number) => {
      if (displayPos <= 2) return displayPos;
      if (displayPos <= 5) return displayPos - 1;
      return displayPos - 2;
    };
    const digitToDisplayPos = (digitPos: number) => {
      if (digitPos <= 2) return digitPos;
      if (digitPos <= 4) return digitPos + 1;
      return digitPos + 2;
    };

    return (
      <div className="flex flex-col h-full justify-center items-center gap-8">
        <div className="text-center mb-8">
          <h2 className="text-4xl font-black italic text-luxury-orange uppercase mb-2">Data da Venda</h2>
          <p className="text-white/40">Digite a data (DD/MM/YYYY)</p>
        </div>
        <div className="text-center">
          <input
            id="header-date-input"
            ref={dateInputRef}
            type="text"
            value={displayValue}
            onChange={() => {}}
            onKeyDown={(e) => {
              const input = e.currentTarget;
              const displayPos = input.selectionStart ?? 0;
              const pos = displayToDigitPos(displayPos);

              if (e.key === 'Escape' || e.key === 'ArrowUp' || e.key === 'ArrowDown' || (e.key === 'ArrowLeft' && displayPos === 0)) {
                e.preventDefault(); e.stopPropagation();
                setDateDigits(getTodayDigitsNow());
                setDateError('');
                const activeSidebarLink = document.querySelector('aside nav a[class*="bg-luxury-orange"]') as HTMLElement;
                activeSidebarLink?.focus();
                return;
              }

              if (e.key === 'Enter') {
                e.preventDefault();
                if (dateDigits.includes('_')) {
                  setDateError('Preencha a data completa.');
                  return;
                }
                const d = parseInt(dateDigits.slice(0, 2));
                const m = parseInt(dateDigits.slice(2, 4));
                const y = parseInt(dateDigits.slice(4, 8));
                if (d < 1 || d > 31) {
                  setDateError(`Dia inválido: ${d}. Deve ser entre 01 e 31.`);
                } else if (m < 1 || m > 12) {
                  setDateError(`Mês inválido: ${m}. Deve ser entre 01 e 12.`);
                } else if (!isValidDate(d, m, y)) {
                  setDateError(`${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y} não existe.`);
                } else {
                  setVendaDate(`${dateDigits.slice(0, 2)}/${dateDigits.slice(2, 4)}/${dateDigits.slice(4, 8)}`);
                  setStage('selling');
                  setDateError('');
                }
                return;
              }

              if (/^\d$/.test(e.key)) {
                e.preventDefault();
                if (pos >= 8) return;
                const newDigits = dateDigits.slice(0, pos) + e.key + dateDigits.slice(pos + 1);
                setDateDigits(newDigits);
                setDateError('');
                const nextDisplayPos = digitToDisplayPos(pos + 1);
                setTimeout(() => input.setSelectionRange(nextDisplayPos, nextDisplayPos), 0);
                return;
              }

              if (e.key === 'Backspace') {
                e.preventDefault();
                if (pos === 0) return;
                const newDigits = dateDigits.slice(0, pos - 1) + '_' + dateDigits.slice(pos);
                setDateDigits(newDigits);
                const prevDisplayPos = digitToDisplayPos(pos - 1);
                setTimeout(() => input.setSelectionRange(prevDisplayPos, prevDisplayPos), 0);
                return;
              }

              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') return;
              e.preventDefault();
            }}
            maxLength={10}
            className="luxury-input w-80 h-16 text-center text-3xl font-black tracking-wider"
            style={{ fontFamily: 'monospace' }}
          />
          {dateError && <p className="text-red-500 text-sm mt-4">{dateError}</p>}
        </div>
        <p className="text-white/40 text-sm">Pressione ENTER para continuar</p>
      </div>
    );
  }

  if (stage === 'selling') {
    return (
      <div className="flex flex-col h-full gap-4 p-4">
        <header className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-3xl font-bold italic text-luxury-orange uppercase">VENDA - {vendaDate}</h2>
            <p className="text-white/40 text-xs mt-1">Escaneie ou digite o código/nome do produto</p>
          </div>
          <div className="glass-card px-6 py-4 flex flex-col items-end">
            <span className="text-[10px] uppercase text-white/40 font-bold">TOTAL</span>
            <span className="text-3xl font-black text-luxury-orange">R$ {total.toFixed(2)}</span>
          </div>
        </header>

        <div className="glass-card px-4 py-2 flex gap-6 text-xs font-bold text-white/40">
          <span><span className="text-luxury-orange">F1</span> = Finalizar</span>
          <span><span className="text-luxury-orange">F2</span> = Impressão</span>
          <span><span className="text-luxury-orange">TAB</span> = Alternar zona</span>
          <span><span className="text-luxury-orange">↑↓</span> = Navegar</span>
          <span><span className="text-luxury-orange">ENTER</span> = Adicionar / Editar</span>
          <span><span className="text-luxury-orange">ESC</span> = Sair</span>
        </div>

        <div className="flex flex-1 gap-4 overflow-hidden">
          <div className={`flex-1 glass-card flex flex-col transition-all ${focusedZone === 'products' ? 'ring-1 ring-luxury-orange/30' : ''}`}>
            <div ref={productFocusTrapRef} tabIndex={-1} className="outline-none w-0 h-0 overflow-hidden" />
            <div className="p-4 border-b border-white/5">
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Código ou nome (máx 40 caracteres)..."
                className="luxury-input w-full h-12 text-lg"
                value={search}
                onChange={e => {
                  let val = e.target.value.toUpperCase().replace(/[^A-Z0-9 ]/g, '');
                  if (val.length > 40) val = val.slice(0, 40);
                  setSearch(val);
                }}
                maxLength={40}
                onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') e.preventDefault(); }}
              />
              {products.length > 0 && <p className="text-white/40 text-xs mt-2">{products.length} resultado(s)</p>}
            </div>
            <div className="flex-1 overflow-auto p-3 space-y-2">
              {products.length > 0 ? (
                products.map((product, pidx) => (
                  <button
                    key={product.id}
                    onClick={() => handleProductSelect(product)}
                    className={`w-full p-3 rounded-lg text-left transition-all border relative overflow-hidden ${
                      focusedProductIndex === pidx
                        ? 'bg-luxury-orange/20 border-luxury-orange shadow-lg shadow-luxury-orange/10 scale-[1.01]'
                        : 'bg-white/5 border-white/5 hover:bg-white/10'
                    }`}
                  >
                    {focusedProductIndex === pidx && <div className="absolute left-0 top-0 bottom-0 w-1 bg-luxury-orange" />}
                    <h4 className={`font-bold ${focusedProductIndex === pidx ? 'text-luxury-orange' : 'text-white'}`}>{product.nome}</h4>
                    <div className="flex justify-between text-white/40 text-xs mt-1">
                      <span>Cód: {product.codigo_barras || 'N/A'}</span>
                      <span className={`font-black ${focusedProductIndex === pidx ? 'text-white' : 'text-luxury-orange'}`}>R$ {product.preco_venda.toFixed(2)}</span>
                    </div>
                  </button>
                ))
              ) : search.length > 0 ? (
                <div className="h-full flex items-center justify-center text-white/10 italic"><p>Nenhum produto</p></div>
              ) : null}
            </div>
            <div className="p-3 border-t border-white/5">
              <button onClick={() => { setCheckoutSelected(getCheckoutDefaultSelection('dinheiro')); setStage('checkout'); }} disabled={cart.length === 0} className="btn-primary w-full h-10 text-sm uppercase disabled:opacity-30 disabled:grayscale">Finalizar Venda</button>
            </div>
          </div>

          <div className={`flex-[0.8] glass-card flex flex-col transition-all ${focusedZone === 'cart' ? 'ring-1 ring-luxury-orange/30' : ''}`}>
            <div ref={cartFocusTrapRef} tabIndex={-1} className="outline-none w-0 h-0 overflow-hidden" />
            <div className="p-4 border-b border-white/5">
              <h3 className="text-lg font-bold uppercase italic text-luxury-orange">CARRINHO ({cart.length})</h3>
            </div>
            <div className="flex-1 overflow-auto p-3 space-y-2">
              {cart.length === 0 ? (
                <div className="h-full flex items-center justify-center text-white/10 italic"><p className="text-xs">VAZIO</p></div>
              ) : (
                cart.map((item, idx) => (
                  <div key={item.cartId} className={`p-3 rounded-lg border transition-all cursor-pointer ${focusedCartIndex === idx ? 'bg-luxury-orange/20 border-luxury-orange/50' : 'bg-white/5 border-white/5 hover:bg-white/10'} ${lastAddedId === item.id ? 'animate-item-flash' : ''}`} onClick={() => setFocusedCartIndex(idx)}>
                    <div className="flex justify-between items-start mb-1">
                      <h4 className="font-bold text-sm flex-1 truncate pr-2">{item.nome}</h4>
                      <span className="text-white/40 text-xs shrink-0">Qtd: {item.quantidade.toFixed(3)}x</span>
                    </div>
                    <div className="flex justify-between text-xs text-white/40">
                      <span>R$ {item.preco.toFixed(2)}/un</span>
                      <span className="text-luxury-orange font-black">R$ {(item.preco * item.quantidade).toFixed(2)}</span>
                    </div>
                    {focusedCartIndex === idx && !editingItemId && confirmDeleteIdx !== idx && (
                      <div className="mt-2 flex gap-2">
                        <button onClick={e => { e.stopPropagation(); editingItemPrecoRef.current = Number(item.preco); setEditingItemId(item.id); setQuantityInput(item.quantidade.toFixed(3)); setEditingTotalInput(formatCurrency(Number(item.preco) * Number(item.quantidade))); setFocusedCartAction(null); }} className={`flex-1 flex items-center justify-center gap-1 h-7 rounded text-xs font-bold transition-all ${focusedCartAction === 'edit' ? 'bg-luxury-orange text-white' : 'bg-white/10 text-white/70'}`}><Pencil size={12} /> Editar</button>
                        <button onClick={e => { e.stopPropagation(); setConfirmDeleteIdx(idx); setFocusedCartAction('delete'); }} className={`flex-1 flex items-center justify-center gap-1 h-7 rounded text-xs font-bold transition-all ${focusedCartAction === 'delete' ? 'bg-red-500 text-white' : 'bg-red-500/10 text-red-400'}`}><Trash2 size={12} /> Remover</button>
                      </div>
                    )}
                    {confirmDeleteIdx === idx && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-xs text-white/60 font-bold flex-1">Remover item?</span>
                        <button onClick={e => { e.stopPropagation(); setCart(prev => prev.filter((_, i) => i !== idx)); setFocusedCartIndex(null); setFocusedCartAction(null); setConfirmDeleteIdx(null); }} className="px-3 h-7 rounded text-xs font-bold bg-red-500 text-white">Sim</button>
                        <button onClick={e => { e.stopPropagation(); setConfirmDeleteIdx(null); setFocusedCartAction(null); }} className="px-3 h-7 rounded text-xs font-bold bg-white/10 text-white/70">Não</button>
                      </div>
                    )}
                    {editingItemId === item.id && (
                      <div className="mt-2 flex flex-col gap-2 p-2 bg-black/40 rounded-lg border border-white/10">
                        <div className="flex gap-2">
                          <div className="flex-1">
                            <label className="text-[10px] uppercase text-white/40 font-bold block mb-1">QTD</label>
                            <input type="text" value={quantityInput} onChange={e => { let val = e.target.value.replace(',', '.'); if (!/^\d*\.?\d*$/.test(val)) return; if (val.split('.')[0].length > 5) return; setQuantityInput(val); }} ref={cartQuantityRef} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); const qty = parseFloat(quantityInput); if (isNaN(qty) || qty <= 0) return; const totalVal = parseCurrencyToNumber(editingTotalInput); setCart(prev => prev.map(it => it.id === item.id ? { ...it, quantidade: qty, preco: totalVal / qty } : it)); setEditingItemId(null); setQuantityInput("1"); setFocusedCartIndex(idx); } else if (e.key === 'Escape') { setEditingItemId(null); } else if (e.key === 'ArrowRight') { cartTotalRef.current?.focus(); cartTotalRef.current?.select(); } else { handleQuantityKeyDown(e); } }} autoFocus className="luxury-input w-full h-9 text-xs text-center" />
                          </div>
                          <div className="flex-1">
                            <label className="text-[10px] uppercase text-white/40 font-bold block mb-1">TOTAL (R$)</label>
                            <input type="text" value={editingTotalInput} ref={cartTotalRef} onChange={e => setEditingTotalInput(handleCurrencyInput(e.target.value))} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); const qty = parseFloat(quantityInput); if (isNaN(qty) || qty <= 0) return; const totalVal = parseCurrencyToNumber(editingTotalInput); setCart(prev => prev.map(it => it.id === item.id ? { ...it, quantidade: qty, preco: totalVal / qty } : it)); setEditingItemId(null); setQuantityInput("1"); setFocusedCartIndex(idx); } else if (e.key === 'Escape') { setEditingItemId(null); } else if (e.key === 'ArrowLeft') { cartQuantityRef.current?.focus(); cartQuantityRef.current?.select(); } }} className="luxury-input w-full h-9 text-xs text-center font-bold text-luxury-orange" />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {showQuantityModal && selectedProduct && createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) setShowQuantityModal(false); }}>
            <div className="glass-card w-full max-w-sm p-8">
              <h3 className="text-2xl font-black mb-2 text-luxury-orange uppercase">{selectedProduct.nome}</h3>
              <p className="text-white/40 text-sm mb-6">R$ {selectedProduct.preco_venda.toFixed(2)}/un</p>
              <label className="text-xs uppercase text-white/40 font-bold block mb-2">Quantidade</label>
              <input type="text" value={quantityInput} onChange={e => setQuantityInput(handleWeightInput(e.target.value))} onBlur={e => setQuantityInput(finalizeWeightInput(e.target.value))} onKeyDown={e => { handleQuantityKeyDown(e); if (e.key === 'Enter') handleAddToCart(); }} ref={modalQuantityRef} className="luxury-input w-full h-12 text-center text-2xl font-bold mb-6" />
              <div className="space-y-2">
                <button ref={addBtnRef} onClick={handleAddToCart} className="btn-primary w-full h-10 uppercase text-sm">Adicionar (ENTER)</button>
                <button onClick={() => setShowQuantityModal(false)} className="w-full h-10 border border-white/10 rounded-lg text-white/40 uppercase text-[10px] font-bold">Cancelar (ESC)</button>
              </div>
            </div>
          </div>, document.body
        )}

        {showExitConfirm && createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) setShowExitConfirm(false); }}>
            <div className="glass-card w-full max-w-sm p-8 text-center">
              <h3 className="text-xl font-black mb-4">Sair sem salvar?</h3>
              <p className="text-white/40 text-sm mb-6">Há {cart.length} item(s) no carrinho.</p>
              <div className="space-y-2">
                <button onClick={() => { setCart([]); setShowExitConfirm(false); setStage('date'); }} className={`btn-primary w-full h-10 uppercase text-sm ${exitConfirmSelected === 'exit' ? 'bg-red-600 ring-2 ring-white/50' : 'bg-red-600/50'}`}>Sair e Limpar</button>
                <button onClick={() => setShowExitConfirm(false)} className={`w-full h-10 border rounded-lg uppercase text-xs font-bold ${exitConfirmSelected === 'continue' ? 'border-white/50 bg-white/10' : 'border-white/10'}`}>Continuar</button>
              </div>
            </div>
          </div>, document.body
        )}

        {showRecentPrintModal && createPortal(
          <div className="fixed inset-0 z-[220] flex items-center justify-center p-6 bg-black/85 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) closeRecentPrintModal(); }}>
            <div className="glass-card w-full max-w-3xl p-8" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="text-xl font-black italic text-luxury-orange uppercase">Últimas Vendas</h3>
                  <p className="text-white/30 text-xs mt-1">Escolha uma venda e pressione ENTER para imprimir direto.</p>
                </div>
                <button onClick={closeRecentPrintModal} className="text-white/40 hover:text-white transition-colors">
                  <X size={20} />
                </button>
              </div>

              <div className="rounded-2xl border border-white/5 overflow-hidden">
                <div className="grid grid-cols-[100px_190px_1fr_120px] gap-3 px-4 py-3 border-b border-white/5 text-[10px] uppercase tracking-widest text-white/30 font-bold">
                  <span>ID</span>
                  <span>Data</span>
                  <span>Método</span>
                  <span className="text-right">Total</span>
                </div>

                <div className="max-h-[340px] overflow-auto">
                  {recentSalesLoading ? (
                    <div className="px-4 py-10 text-center text-sm text-white/30 uppercase font-bold tracking-widest">Carregando vendas...</div>
                  ) : recentSales.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm text-white/30 uppercase font-bold tracking-widest">Nenhuma venda encontrada</div>
                  ) : (
                    recentSales.map((sale, index) => {
                      const selected = selectedRecentSaleIndex === index;
                      const canceled = String(sale.status || "").toLowerCase() === "cancelada";
                      return (
                        <button
                          key={sale.id}
                          type="button"
                          onClick={() => setSelectedRecentSaleIndex(index)}
                          onDoubleClick={() => { void handleManualPrintSale(sale); }}
                          className={`grid w-full grid-cols-[100px_190px_1fr_120px] gap-3 px-4 py-3 text-left border-b border-white/5 transition-all ${
                            canceled
                              ? selected
                                ? "bg-red-500/18 ring-1 ring-inset ring-red-500/35"
                                : "bg-red-500/10 hover:bg-red-500/14"
                              : selected
                                ? "bg-luxury-orange/15 ring-1 ring-inset ring-luxury-orange/30"
                                : "hover:bg-white/5"
                          }`}
                        >
                          <span className={`font-mono text-sm ${canceled ? "text-red-200/80 line-through" : "text-white/50"}`}>#{sale.id}</span>
                          <span className={`font-mono text-sm ${canceled ? "text-red-200/80 line-through" : "text-white/70"}`}>{formatSaleDateTime(sale.data_venda)}</span>
                          <span className={`font-bold text-sm truncate ${canceled ? "text-red-200/90 line-through" : getSalePaymentColor(sale.metodo_pagamento)}`}>{getSalePaymentLabel(sale)}</span>
                          <span className={`text-right font-black ${canceled ? "text-red-100/90 line-through" : "text-white"}`}>R$ {formatCurrency(sale.total_venda)}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between text-[10px] uppercase tracking-widest text-white/30 font-bold">
                <span>↑↓ Navegar</span>
                <span>Enter Imprimir</span>
                <span className="text-luxury-orange">F3 Cancelar Venda</span>
                <span>Esc Fechar</span>
              </div>
            </div>
          </div>, document.body
        )}

        {showRecentPrintModal && recentPrintConfirmSale && createPortal(
          <div
            className="fixed inset-0 z-[230] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
            onClick={e => {
              if (e.target === e.currentTarget) {
                setRecentPrintConfirmSale(null);
                setRecentPrintSummaryExpanded(false);
                setRecentPrintPreviewItems([]);
                setRecentPrintPreviewPayments([]);
              }
            }}
          >
            <div className="glass-card flex max-h-[min(92vh,860px)] w-full max-w-[640px] flex-col overflow-hidden p-6 text-center" onClick={e => e.stopPropagation()}>
              <div className="mb-4 flex items-center justify-center gap-4 text-left">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-luxury-orange/20 bg-luxury-orange/10">
                  <Printer size={22} className="text-luxury-orange" />
                </div>
                <div>
                  <h3 className="text-xl font-bold uppercase tracking-tight text-white">Imprimir Venda</h3>
                  <p className="text-[11px] uppercase tracking-[0.1em] text-white/50">
                    Deseja imprimir a venda selecionada?
                  </p>
                </div>
              </div>

              <div className="mb-6 rounded-2xl border border-luxury-orange/15 bg-luxury-orange/5 px-5 py-4 text-left">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/30">Venda</p>
                    <p className="text-2xl font-extrabold text-luxury-orange">#{recentPrintConfirmSale.id}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/30">Total</p>
                    <p className="text-2xl font-extrabold text-white">R$ {recentPrintConfirmSale.total_venda.toFixed(2)}</p>
                  </div>
                </div>
              </div>

              <div ref={recentPrintContentScrollRef} className="mb-6 min-h-0 flex-1 overflow-y-auto pr-1">
                <div className="rounded-2xl border border-white/5 bg-white/[0.03] text-left">
                  <div className="px-5 pb-5 pt-4">
                    {recentPrintPreviewPayments.length > 0 && (
                      <div className="mb-4 rounded-xl border border-white/5 bg-black/20 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setRecentPrintSummaryExpanded((prev) => !prev)}
                          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.02]"
                        >
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-white/20">Pagamentos</p>
                            <p className="mt-1 text-sm font-semibold text-white/60">
                              {recentPrintSummaryExpanded ? "Ocultar formas de pagamento" : "Ver formas de pagamento"}
                            </p>
                          </div>
                          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/20 text-white/60">
                            {recentPrintSummaryExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                          </div>
                        </button>

                        {recentPrintSummaryExpanded && (
                          <div className="grid gap-2 border-t border-white/5 px-4 pb-4 pt-3">
                            {recentPrintPreviewPayments.map((payment) => (
                              <div
                                key={`${payment.metodo}-${payment.id}`}
                                className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2"
                              >
                                <span className="text-sm font-bold text-white/80">{getPaymentMethodLabel(payment.metodo)}</span>
                                <span className="text-sm font-extrabold text-luxury-orange">R$ {payment.valor.toFixed(2)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="rounded-xl border border-white/5 bg-black/20 overflow-hidden">
                      <div className="grid grid-cols-[90px_1fr_120px] gap-3 border-b border-white/5 px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-white/20">
                        <span>Quant.</span>
                        <span>Item</span>
                        <span className="text-right">Preço</span>
                      </div>
                      <div className="max-h-[280px] overflow-auto">
                        {recentPrintPreviewLoading ? (
                          <div className="px-4 py-8 text-center text-xs font-bold uppercase tracking-widest text-white/30">Carregando itens...</div>
                        ) : recentPrintPreviewItems.length === 0 ? (
                          <div className="px-4 py-8 text-center text-xs font-bold uppercase tracking-widest text-white/30">Nenhum item encontrado</div>
                        ) : (
                            recentPrintPreviewItems.map((item) => (
                              <div
                                key={item.id}
                                className="grid grid-cols-[90px_1fr_120px] gap-3 border-b border-white/5 px-4 py-3 last:border-b-0"
                              >
                              <span className="font-mono text-sm text-luxury-orange">{item.quantidade}x</span>
                              <span className="truncate text-sm font-bold text-white/80">{item.produto_nome}</span>
                              <span className="text-right text-sm font-black text-white">R$ {formatCurrency(item.preco_unitario)}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid shrink-0 grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setRecentPrintConfirmSale(null);
                    setRecentPrintSummaryExpanded(false);
                    setRecentPrintPreviewItems([]);
                    setRecentPrintPreviewPayments([]);
                  }}
                  className={`h-12 rounded-xl font-bold uppercase text-[10px] tracking-widest transition-all ${
                    recentPrintActionSelected === "cancel"
                      ? "bg-red-600 text-white ring-2 ring-white/50 shadow-lg shadow-red-600/20 scale-[1.02]"
                      : "bg-red-600/10 text-red-400 border border-red-500/10 hover:bg-red-600/20"
                  }`}
                >
                  CANCELAR (ESC)
                </button>
                <button
                  type="button"
                  disabled={printingRecentSale}
                  onClick={() => handleManualPrintSale(recentPrintConfirmSale)}
                  className={`h-12 rounded-xl font-bold italic uppercase tracking-widest text-[10px] transition-all disabled:opacity-50 ${
                    recentPrintActionSelected === "print"
                      ? "bg-luxury-orange text-white ring-2 ring-white/20 shadow-lg shadow-luxury-orange/30 scale-[1.02]"
                      : "bg-luxury-orange/20 text-luxury-orange/60"
                  }`}
                >
                  IMPRIMIR (ENTER)
                </button>
              </div>
            </div>
          </div>, document.body
        )}

        {showRecentPrintModal && recentCancelPasswordSale && createPortal(
          <div className="fixed inset-0 z-[235] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm">
            <div className="glass-card w-full max-w-[420px] p-6" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-black uppercase text-luxury-orange mb-2">Senha Admin</h3>
              <p className="text-sm text-white/60 mb-4">Digite a senha para cancelar a venda #{recentCancelPasswordSale.id}.</p>
              <input
                ref={recentCancelPasswordInputRef}
                type="password"
                value={recentCancelPasswordInput}
                onChange={(e) => {
                  setRecentCancelPasswordInput(sanitizeAccessPassword(e.target.value));
                  setRecentCancelPasswordError(false);
                }}
                className={`luxury-input w-full h-12 text-center text-lg font-black ${recentCancelPasswordError ? "border-red-500/50 bg-red-500/5 text-red-400" : ""}`}
                maxLength={4}
                autoFocus
              />
              {recentCancelPasswordError && (
                <p className="mt-3 text-xs font-bold uppercase tracking-widest text-red-400">Senha invalida</p>
              )}
              <div className="mt-5 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setRecentCancelPasswordSale(null);
                    setRecentCancelPasswordInput("");
                    setRecentCancelPasswordError(false);
                  }}
                  className="h-12 rounded-xl border border-white/10 text-white/60 font-bold uppercase text-xs hover:bg-white/5"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void submitRecentCancelPassword()}
                  className="h-12 rounded-xl bg-luxury-orange text-white font-bold uppercase text-xs"
                >
                  Confirmar
                </button>
              </div>
            </div>
          </div>, document.body
        )}

        {showRecentPrintModal && recentCancelConfirmSale && createPortal(
          <div className="fixed inset-0 z-[236] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm">
            <div className="glass-card w-full max-w-[460px] p-6 text-center" onClick={e => e.stopPropagation()}>
              <h3 className="text-xl font-black uppercase text-white mb-3">Cancelar Venda</h3>
              <p className="text-sm text-white/60 mb-6">
                Deseja cancelar a venda #{recentCancelConfirmSale.id} - R$ {formatCurrency(recentCancelConfirmSale.total_venda)}?
              </p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setRecentCancelConfirmSale(null)}
                  className={`h-12 rounded-xl border font-bold uppercase text-xs transition-all ${
                    recentCancelActionSelected === "cancel"
                      ? "border-white/30 bg-white/10 text-white ring-2 ring-white/15"
                      : "border-white/10 text-white/60"
                  }`}
                >
                  Nao
                </button>
                <button
                  type="button"
                  onClick={() => void confirmRecentSaleCancel()}
                  className={`h-12 rounded-xl font-bold uppercase text-xs transition-all ${
                    recentCancelActionSelected === "confirm"
                      ? "bg-red-600 text-white ring-2 ring-red-400/30"
                      : "bg-red-600/85 text-white"
                  }`}
                >
                  Sim
                </button>
              </div>
            </div>
          </div>, document.body
        )}

        {postFinalizePrintJob && createPortal(
          <div
            className="fixed inset-0 z-[240] flex items-center justify-center p-6 bg-black/75 backdrop-blur-sm"
            onClick={e => {
              if (e.target === e.currentTarget) {
                closePostFinalizePrintModal();
              }
            }}
          >
            <div className="glass-card w-full max-w-[520px] p-8 text-center" onClick={e => e.stopPropagation()}>
              <div className="w-16 h-16 rounded-full bg-luxury-orange/10 flex items-center justify-center mx-auto mb-6 border border-luxury-orange/20">
                <Printer size={30} className="text-luxury-orange" />
              </div>

              <h3 className="text-xl font-bold text-white uppercase mb-2 tracking-tight">Venda Finalizada</h3>
              <p className="text-white/60 text-xs mb-3 uppercase tracking-[0.1em] leading-relaxed">
                Deseja imprimir a venda agora?
              </p>
              <p className="text-luxury-orange text-lg font-extrabold mb-2">
                {postFinalizePrintJob.copies} {postFinalizePrintJob.copies === 1 ? "via" : "vias"}
              </p>
              <p className="text-white/45 text-[11px] uppercase tracking-[0.12em] mb-8">
                Venda #{postFinalizePrintJob.sale.id} • {getSalePaymentLabel(postFinalizePrintJob.sale)}
              </p>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={closePostFinalizePrintModal}
                  className={`h-12 rounded-xl font-bold uppercase text-[10px] tracking-widest transition-all ${
                    postFinalizePrintActionSelected === "close"
                      ? "bg-red-600 text-white ring-2 ring-white/50 shadow-lg shadow-red-600/20 scale-[1.02]"
                      : "bg-red-600/10 text-red-400 border border-red-500/10 hover:bg-red-600/20"
                  }`}
                >
                  FECHAR (ESC)
                </button>
                <button
                  type="button"
                  disabled={printingPostFinalizeSale}
                  onClick={() => void handlePostFinalizePrint()}
                  className={`h-12 rounded-xl font-bold italic uppercase tracking-widest text-[10px] transition-all disabled:opacity-50 ${
                    postFinalizePrintActionSelected === "print"
                      ? "bg-luxury-orange text-white ring-2 ring-white/20 shadow-lg shadow-luxury-orange/30 scale-[1.02]"
                      : "bg-luxury-orange/20 text-luxury-orange/60"
                  }`}
                >
                  IMPRIMIR (ENTER)
                </button>
              </div>
            </div>
          </div>, document.body
        )}
        {vendaSuccessToast}
      </div>
    );
  }

  // Stage: Checkout
  const coSel = (id: CheckoutOption) => checkoutSelected === id;
  const coBtn = (id: CheckoutOption, extra?: string) =>
    `flex items-center gap-3 p-3 rounded-xl border transition-all text-left outline-none ${
      coSel(id)
        ? 'bg-luxury-orange border-luxury-orange shadow-lg shadow-luxury-orange/20'
        : `bg-white/5 border-white/5 hover:bg-white/10 ${extra ?? ''}`
    }`;

  if (stage === 'checkout') {
    return (
      <>
      <div className="flex h-full min-h-0 flex-col items-center overflow-y-auto px-3 py-2.5">
        <div className="flex w-full max-w-[820px] flex-col gap-2 pb-2">
          <div className="flex gap-2">
            <div className="glass-card flex min-w-[68px] flex-col items-center justify-center px-3 py-2">
              <p className="mb-0.5 text-[10px] font-bold uppercase text-white/40">Itens</p>
              <p className="text-xl font-black">{cart.length}</p>
            </div>
            <div className="glass-card flex flex-1 flex-col items-center justify-center px-4 py-2 text-center">
              {nextSaleId !== null && (
                <p className="mb-0.5 text-[11px] font-bold uppercase tracking-[0.14em] text-white/50">
                  Pedido #{nextSaleId}
                </p>
              )}
              <p className="mb-0.5 text-[10px] font-bold uppercase text-white/40">Data</p>
              <p className="text-base font-black">{vendaDate}</p>
            </div>
            <div className="glass-card flex-[2] border border-luxury-orange/30 bg-luxury-orange/5 px-4 py-2">
              <p className="mb-0.5 text-[10px] font-bold uppercase text-white/40">Total a Pagar</p>
              <p className="text-[2rem] font-black leading-none text-luxury-orange">R$ {total.toFixed(2)}</p>
              <div className="mt-1 grid grid-cols-3 gap-2 text-[10px] uppercase">
                <div>
                  <p className="text-white/30 font-bold">Lançado</p>
                  <p className="text-white font-black text-sm normal-case">R$ {checkoutSummary.totalLancado.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-white/30 font-bold">Restante</p>
                  <p className={`font-black text-sm normal-case ${checkoutSummary.restante > 0 ? "text-yellow-400" : "text-green-400"}`}>R$ {checkoutSummary.restante.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-white/30 font-bold">Troco</p>
                  <p className="text-green-400 font-black text-sm normal-case">R$ {checkoutSummary.troco.toFixed(2)}</p>
                </div>
              </div>
            </div>
          </div>

          <div>
            <p className="mb-1.5 px-1 text-[10px] font-bold uppercase text-white/40">Lançar Pagamentos</p>
            <div className="mb-1.5 grid grid-cols-2 gap-2">
              {([
                { id: 'dinheiro' as CheckoutOption, label: 'Dinheiro', icon: Banknote   },
                { id: 'pix'      as CheckoutOption, label: 'PIX',      icon: QrCode     },
                { id: 'credito'  as CheckoutOption, label: 'Crédito',  icon: CreditCard },
                { id: 'debito'   as CheckoutOption, label: 'Débito',   icon: Smartphone },
              ] as const).map(m => (
                <button key={m.id} onClick={() => openPaymentAmountModal(m.id)} className={coBtn(m.id)}>
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${coSel(m.id) ? 'bg-white/20' : 'bg-luxury-orange/10'}`}><m.icon size={20} className={coSel(m.id) ? 'text-white' : 'text-luxury-orange'} /></div>
                  <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                    <p className={`min-w-0 text-left font-black uppercase text-sm ${coSel(m.id) ? 'text-white' : ''}`}>{m.label}</p>
                    {checkoutPayments.find((entry) => entry.method === m.id) && (
                      <p className={`shrink-0 text-[15px] font-extrabold ${coSel(m.id) ? 'text-white' : 'text-luxury-orange'}`}>
                        R$ {checkoutPayments.find((entry) => entry.method === m.id)?.amount.toFixed(2)}
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
            <button onClick={handleAPrazo} className={`w-full mb-1.5 ${coBtn('prazo')}`}>
              <div className="grid w-full grid-cols-[64px_minmax(0,1fr)_132px] items-center gap-4">
                <div className={`flex w-16 flex-col items-center justify-center rounded-xl py-2 ${coSel('prazo') ? 'bg-white/20' : 'bg-luxury-orange/10'}`}>
                  <Clock size={20} className={coSel('prazo') ? 'text-white' : 'text-luxury-orange'} />
                  <span className={`mt-1 text-[10px] font-black uppercase tracking-[0.12em] ${coSel('prazo') ? 'text-white' : 'text-luxury-orange'}`}>A Prazo</span>
                </div>
                <div className="flex min-w-0 items-center justify-center px-3 text-center">
                    {clienteSelecionado ? (
                      <p className={`truncate text-base font-semibold leading-tight ${coSel('prazo') ? 'text-white' : 'text-white'}`}>{clienteSelecionado.nome}</p>
                    ) : (
                      <p className={`text-sm font-medium leading-tight ${coSel('prazo') ? 'text-white/75' : 'text-white/45'}`}>Selecionar cliente para fiado</p>
                    )}
                </div>
                <div className="flex h-full w-[132px] items-center justify-end pr-1 text-right">
                    {checkoutPayments.find((entry) => entry.method === "prazo") ? (
                      <div className="text-right">
                        <p className={`text-[10px] font-bold uppercase tracking-[0.12em] ${coSel('prazo') ? 'text-white/75' : 'text-white/35'}`}>Total</p>
                        <p className={`text-lg font-bold leading-tight ${coSel('prazo') ? 'text-white' : 'text-luxury-orange'}`}>
                          R$ {checkoutPayments.find((entry) => entry.method === "prazo")?.amount.toFixed(2)}
                        </p>
                      </div>
                    ) : (
                      <p className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${coSel('prazo') ? 'text-white/70' : 'text-white/35'}`}>
                        Sem valor
                      </p>
                    )}
                </div>
              </div>
            </button>
          </div>
          <div className="glass-card flex h-[220px] min-h-[220px] shrink-0 flex-col p-2.5">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[10px] uppercase text-white/40 font-bold">Pagamentos Lançados</p>
              {checkoutPayments.length > 0 && (
                <button
                  type="button"
                  onClick={clearCheckoutPayments}
                  className="text-[10px] uppercase font-bold tracking-widest text-red-400 hover:text-red-300 transition-colors"
                >
                  Limpar
                </button>
              )}
            </div>
            <div className="grid auto-rows-min content-start grid-cols-2 gap-2 pr-1">
              {checkoutPayments.length === 0 ? (
                <p className="col-span-2 text-sm text-white/30">Nenhum pagamento lançado ainda.</p>
              ) : (
                checkoutPayments.map((entry) => (
                  <div
                    key={entry.method}
                    className={`flex min-h-[52px] self-start items-center justify-between gap-2 rounded-xl border px-3 py-2 transition-all ${
                      checkoutSelected === getCheckoutDeleteSelection(entry.method)
                        ? "border-red-400/50 bg-red-500/10 ring-1 ring-red-400/30"
                        : "border-white/5 bg-white/[0.03]"
                    }`}
                  >
                    <div>
                      <p className="text-[13px] font-black uppercase text-white">{getPaymentMethodLabel(entry.method)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-[15px] font-black text-luxury-orange">R$ {entry.amount.toFixed(2)}</p>
                      <button
                        type="button"
                        onClick={() => removeCheckoutPayment(entry.method)}
                        onFocus={() => setCheckoutSelected(getCheckoutDeleteSelection(entry.method))}
                        className={`rounded-lg border p-1.5 transition-all ${
                          checkoutSelected === getCheckoutDeleteSelection(entry.method)
                            ? "border-red-400/40 bg-red-500/20 text-red-300"
                            : "border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20"
                        }`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setStage('selling')}
              className={`h-12 rounded-xl border uppercase text-xs font-bold transition-all ${
                checkoutSelected === "back"
                  ? "border-white/30 bg-white/10 text-white ring-2 ring-white/15"
                  : "border-white/10 text-white/40 hover:bg-white/5 hover:text-white"
              }`}
            >
              Voltar (Esc)
            </button>
            <button
              type="button"
              disabled={!checkoutSummary.isComplete || (checkoutPayments.some((entry) => entry.method === "prazo") && !clienteSelecionado)}
              onClick={requestFinalizeCheckout}
              className={`h-12 rounded-xl uppercase text-sm font-black tracking-widest transition-all ${
                checkoutSummary.isComplete && !(checkoutPayments.some((entry) => entry.method === "prazo") && !clienteSelecionado)
                  ? checkoutSelected === "confirm"
                    ? "bg-luxury-orange text-white ring-2 ring-white/25 shadow-lg shadow-luxury-orange/30"
                    : "bg-luxury-orange text-white shadow-lg shadow-luxury-orange/20"
                  : "bg-white/10 text-white/30 cursor-not-allowed"
              }`}
            >
              Confirmar Pagamentos (F1)
            </button>
          </div>
        </div>
      </div>

      {showClienteModal && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) setShowClienteModal(false); }}>
          <div className="glass-card w-full max-w-xl p-8">
            <div className="flex justify-between items-center mb-5"><h3 className="text-xl font-black italic text-luxury-orange uppercase">Selecionar Cliente</h3><button onClick={() => setShowClienteModal(false)} className="text-white/40 hover:text-white"><X size={20} /></button></div>
            <input autoFocus type="text" placeholder="Buscar cliente..." className="luxury-input w-full h-11 mb-3" value={clienteSearch} onChange={e => { setClienteSearch(e.target.value.toUpperCase()); setClienteFocusedIdx(-1); setClienteSelecionado(null); }} />
            <div ref={clienteListRef} className="max-h-80 overflow-auto space-y-1 mb-4 pr-1">
              {(() => {
                const filtered = clientes.filter(c => c.nome.includes(clienteSearch) || (c.telefone || '').includes(clienteSearch));
                clienteItemRefs.current = [];
                if (filtered.length === 0) return <p className="text-center text-white/30 text-sm py-6">Nenhum cliente encontrado</p>;
                return filtered.map((c, idx) => {
                  const isSelected = clienteSelecionado?.id === c.id;
                  const isFocused = clienteFocusedIdx === idx;
                  return (
                    <button key={c.id} ref={el => { clienteItemRefs.current[idx] = el; }} onClick={() => { setClienteSelecionado({ id: c.id, nome: c.nome }); setClienteFocusedIdx(idx); }} className={`w-full text-left px-4 py-3 rounded-xl transition-all font-semibold flex items-center gap-3 outline-none ${isSelected ? 'bg-luxury-orange text-white ring-2 ring-luxury-orange/50' : isFocused ? 'bg-luxury-orange/20 text-white ring-1 ring-luxury-orange/30' : 'bg-white/5 hover:bg-white/10 text-white/80'}`}>
                      <span className={`text-xs font-mono shrink-0 ${isSelected ? 'text-white/70' : 'text-white/30'}`}>#{c.id}</span>
                      <span className="flex-1">{c.nome}</span>
                      {isSelected && <span className="text-xs text-white/60 font-normal">↵ confirmar</span>}
                    </button>
                  );
                });
              })()}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowClienteModal(false)} className="flex-1 h-12 border border-white/10 rounded-xl hover:bg-white/5 uppercase text-xs font-bold text-white/40 hover:text-white transition-all">Cancelar</button>
              <button disabled={!clienteSelecionado} onClick={confirmClienteSelection} className="btn-primary flex-1 h-12 disabled:opacity-40 disabled:cursor-not-allowed">Confirmar</button>
            </div>
          </div>
        </div>, document.body
      )}

      {showPaymentConfirm && pendingPayment && createPortal(
        <div 
          ref={el => { if (el && showPaymentConfirm) el.focus(); }}
          className="fixed inset-0 z-[300] flex items-center justify-center p-6 bg-black/90 backdrop-blur-md outline-none"
          tabIndex={0}
          onKeyDown={e => {
            e.stopPropagation();
            if (e.key === 'Escape') { 
              e.preventDefault(); 
              setShowPaymentConfirm(false); 
            }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              setConfirmActionSelected(prev => prev === 'confirm' ? 'cancel' : 'confirm');
            }
            if (e.key === 'Enter') { 
              e.preventDefault(); 
              if (confirmActionSelected === 'confirm') {
                handleFinalize(pendingPayment.method, clienteSelecionado?.id, checkoutPayments); 
              } else {
                setShowPaymentConfirm(false);
              }
            }
          }}
        >
          <div className="glass-card w-full max-w-[400px] p-8 text-center animate-in zoom-in duration-200 border-white/10" onClick={e => e.stopPropagation()}>
            <div className="w-16 h-16 rounded-full bg-luxury-orange/10 flex items-center justify-center mx-auto mb-6 border border-luxury-orange/20">
              <Check size={32} className="text-luxury-orange" />
            </div>
            
            <h3 className="text-xl font-bold text-white uppercase mb-2 tracking-tight">Confirmar Venda</h3>
            <p className="text-white/70 text-xs mb-6 uppercase tracking-[0.1em] leading-relaxed">
              Deseja confirmar o pagamento em <br/>
              <span className="text-luxury-orange text-lg font-extrabold block mt-2">{pendingPayment.label}</span>
              {pendingPayment.method === 'prazo' && clienteSelecionado && (
                <span className="text-white/60 block mt-1 normal-case tracking-normal">para <span className="text-white font-bold">{clienteSelecionado.nome}</span></span>
              )}
            </p>

            <div className="bg-white/[0.03] rounded-2xl p-6 mb-8 border border-white/5">
              <p className="text-[10px] text-white/20 uppercase font-bold mb-1 tracking-widest">Total a Pagar</p>
              <p className="text-3xl font-bold italic text-luxury-orange tracking-tighter">
                R$ {total.toFixed(2)}
              </p>
            </div>

            {pendingPayment.method !== "prazo" && checkoutPaymentLines.length > 0 && (
              <div className="mb-8 rounded-2xl border border-white/5 bg-white/[0.03] p-4 text-left">
                <p className="text-[10px] text-white/20 uppercase font-bold mb-3 tracking-widest">Pagamentos</p>
                <div className="space-y-2">
                  {checkoutPaymentLines.map((line) => (
                    <div key={line} className="flex items-center justify-between gap-2 text-sm font-bold text-white/80">
                      <span>{line.split(":")[0]}</span>
                      <span className="text-luxury-orange">{line.split(": ")[1]}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setShowPaymentConfirm(false)}
                className={`h-12 rounded-xl font-bold uppercase text-[10px] tracking-widest transition-all ${
                  confirmActionSelected === 'cancel'
                    ? 'bg-red-600 text-white ring-2 ring-white/50 shadow-lg shadow-red-600/20 scale-[1.02]'
                    : 'bg-red-600/10 text-red-400 border border-red-500/10 hover:bg-red-600/20'
                }`}
              >
                CANCELAR (ESC)
              </button>
              <button
                type="button"
                onClick={() => handleFinalize(pendingPayment.method, clienteSelecionado?.id, checkoutPayments)}
                className={`h-12 rounded-xl font-bold italic uppercase tracking-widest text-[10px] transition-all ${
                  confirmActionSelected === 'confirm'
                    ? 'bg-luxury-orange text-white ring-2 ring-white/50 shadow-lg shadow-luxury-orange/40 scale-[1.02]'
                    : 'bg-luxury-orange/20 text-luxury-orange/60'
                }`}
              >
                CONFIRMAR (ENTER)
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showPaymentAmountModal && paymentAmountMethod && createPortal(
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center p-6 bg-black/90 backdrop-blur-md"
          onClick={e => { if (e.target === e.currentTarget) closePaymentAmountModal(); }}
        >
          <div
            className="glass-card w-full max-w-[420px] p-8 text-center animate-in zoom-in duration-200 border-white/10"
            onClick={e => e.stopPropagation()}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === "Escape") {
                e.preventDefault();
                closePaymentAmountModal();
                return;
              }
              if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                e.preventDefault();
                setPaymentAmountActionSelected((prev) => (prev === "confirm" ? "cancel" : "confirm"));
                return;
              }
              if (e.key === "Enter") {
                e.preventDefault();
                if (paymentAmountActionSelected === "confirm") {
                  confirmPaymentAmount();
                } else {
                  closePaymentAmountModal();
                }
              }
            }}
          >
            <div className="w-16 h-16 rounded-full bg-luxury-orange/10 flex items-center justify-center mx-auto mb-6 border border-luxury-orange/20">
              {paymentAmountMethod === "dinheiro" ? (
                <Banknote size={32} className="text-luxury-orange" />
              ) : paymentAmountMethod === "pix" ? (
                <QrCode size={32} className="text-luxury-orange" />
              ) : paymentAmountMethod === "credito" ? (
                <CreditCard size={32} className="text-luxury-orange" />
              ) : (
                <Smartphone size={32} className="text-luxury-orange" />
              )}
            </div>

            <h3 className="text-xl font-bold text-white uppercase mb-2 tracking-tight">
              Lançar {getPaymentMethodLabel(paymentAmountMethod)}
            </h3>
            <p className="text-white/60 text-xs mb-6 uppercase tracking-[0.1em]">
              {currentMethodPayment ? "Atualize o valor lançado" : "Informe o valor deste pagamento"}
            </p>

            <div className="grid grid-cols-2 gap-3 mb-4 text-left">
              <div className="bg-white/[0.03] rounded-2xl p-4 border border-white/5">
                <p className="text-[10px] text-white/20 uppercase font-bold mb-1 tracking-widest">Restante</p>
                <p className="text-2xl font-bold italic text-luxury-orange">R$ {checkoutSummary.restante.toFixed(2)}</p>
              </div>
              <div className="bg-white/[0.03] rounded-2xl p-4 border border-white/5">
                <p className="text-[10px] text-white/20 uppercase font-bold mb-1 tracking-widest">
                  {paymentAmountMethod === "dinheiro" ? "Troco" : "Lançado atual"}
                </p>
                <p className={`text-2xl font-bold italic ${paymentAmountMethod === "dinheiro" ? "text-green-400" : "text-white"}`}>
                  R$ {(paymentAmountMethod === "dinheiro" ? amountModalSummary.troco : currentMethodPayment?.amount || 0).toFixed(2)}
                </p>
              </div>
            </div>

            <div className="mb-6 text-left">
              <label className="text-[10px] uppercase text-white/30 font-bold mb-2 block tracking-widest">Valor</label>
              <input
                ref={paymentAmountRef}
                type="text"
                value={paymentAmountInput}
                onChange={e => setPaymentAmountInput(handleCurrencyInput(e.target.value))}
                className="luxury-input w-full h-14 text-center text-2xl font-black text-luxury-orange"
              />
              {paymentAmountMethod === "dinheiro" && !amountModalSummary.isEnough && (
                <p className="text-red-400 text-xs mt-3 font-bold uppercase tracking-[0.1em]">
                  Faltam R$ {amountModalSummary.falta.toFixed(2)}
                </p>
              )}
              {paymentAmountMethod !== "dinheiro" && parseCurrencyToNumber(paymentAmountInput) > checkoutSummary.restante + (currentMethodPayment?.amount || 0) && (
                <p className="text-red-400 text-xs mt-3 font-bold uppercase tracking-[0.1em]">
                  Valor maior que o restante da venda.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={closePaymentAmountModal}
                className={`h-12 rounded-xl font-bold uppercase text-[10px] tracking-widest transition-all ${
                  paymentAmountActionSelected === "cancel"
                    ? "bg-red-600 text-white ring-2 ring-white/50 shadow-lg shadow-red-600/20 scale-[1.02]"
                    : "bg-red-600/10 text-red-400 border border-red-500/10 hover:bg-red-600/20"
                }`}
              >
                CANCELAR (ESC)
              </button>
              <button
                type="button"
                disabled={
                  parseCurrencyToNumber(paymentAmountInput) <= 0 ||
                  (paymentAmountMethod !== "dinheiro" &&
                    parseCurrencyToNumber(paymentAmountInput) > checkoutSummary.restante + (currentMethodPayment?.amount || 0))
                }
                onClick={confirmPaymentAmount}
                className={`h-12 rounded-xl font-bold italic uppercase tracking-widest text-[10px] transition-all ${
                  parseCurrencyToNumber(paymentAmountInput) > 0 &&
                  (paymentAmountMethod === "dinheiro" ||
                    parseCurrencyToNumber(paymentAmountInput) <= checkoutSummary.restante + (currentMethodPayment?.amount || 0))
                    ? paymentAmountActionSelected === "confirm"
                      ? "bg-luxury-orange text-white ring-2 ring-white/20 shadow-lg shadow-luxury-orange/30 scale-[1.02]"
                      : "bg-luxury-orange/20 text-luxury-orange/60"
                    : "bg-white/10 text-white/30 cursor-not-allowed"
                }`}
              >
                LANÇAR (ENTER)
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {vendaSuccessToast}
      </>
    );
  }
}
