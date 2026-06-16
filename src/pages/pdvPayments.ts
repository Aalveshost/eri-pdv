export type PaymentMethod = "dinheiro" | "pix" | "credito" | "debito" | "prazo";

export interface PaymentEntryInput {
  method: PaymentMethod;
  amount: number;
}

interface PaymentDetailOptions {
  prazoLabel?: string;
}

export interface PaymentEntry extends PaymentEntryInput {
  order: number;
}

export interface SalePaymentRow {
  id?: number;
  venda_id?: number;
  metodo: string;
  valor: number;
  ordem: number;
}

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  dinheiro: "Dinheiro",
  pix: "PIX",
  credito: "Credito",
  debito: "Debito",
  prazo: "A Prazo",
};

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function normalizePaymentEntries(entries: PaymentEntryInput[]) {
  return entries.reduce<PaymentEntry[]>((acc, entry) => {
    const amount = roundMoney(Number(entry.amount));
    if (!Number.isFinite(amount) || amount <= 0) return acc;
    acc.push({
      method: entry.method,
      amount,
      order: acc.length,
    });
    return acc;
  }, []);
}

export function getCheckoutPaymentsSummary(total: number, entries: PaymentEntryInput[]) {
  const normalized = normalizePaymentEntries(entries);
  const totalLancado = roundMoney(normalized.reduce((sum, entry) => sum + entry.amount, 0));
  const totalSemDinheiro = roundMoney(
    normalized.filter((entry) => entry.method !== "dinheiro").reduce((sum, entry) => sum + entry.amount, 0),
  );
  const totalDinheiro = roundMoney(
    normalized.filter((entry) => entry.method === "dinheiro").reduce((sum, entry) => sum + entry.amount, 0),
  );
  const restanteAntesDinheiro = roundMoney(Math.max(0, total - totalSemDinheiro));
  const troco = roundMoney(Math.max(0, totalDinheiro - restanteAntesDinheiro));
  const restante = roundMoney(Math.max(0, total - totalLancado));

  return {
    totalLancado,
    restante,
    troco,
    isComplete: totalLancado >= roundMoney(total),
  };
}

export function getResumoMetodoPagamento(entries: PaymentEntryInput[]) {
  const normalized = normalizePaymentEntries(entries);
  if (normalized.length === 0) return "dinheiro";
  if (normalized.length === 1) return normalized[0].method;
  return "misto";
}

export function getPaymentMethodLabel(method: string) {
  if (method === "misto") return "Misto";
  return PAYMENT_LABELS[method as PaymentMethod] || method;
}

export function mapSalePaymentRows(rows: SalePaymentRow[]): PaymentEntry[] {
  return normalizePaymentEntries(
    [...rows]
      .sort((a, b) => a.ordem - b.ordem)
      .map((row) => ({
        method: row.metodo as PaymentMethod,
        amount: row.valor,
      })),
  );
}

export function buildPaymentDetailLines(entries: PaymentEntryInput[], options: PaymentDetailOptions = {}) {
  return normalizePaymentEntries(entries).map((entry) => {
    if (entry.method === "prazo" && options.prazoLabel) {
      return `Crediario: ${options.prazoLabel}`;
    }

    return `${getPaymentMethodLabel(entry.method)}: R$ ${entry.amount.toFixed(2).replace(".", ",")}`;
  });
}
