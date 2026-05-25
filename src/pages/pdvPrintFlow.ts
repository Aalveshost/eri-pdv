export interface PrintConfig {
  autoPrintEnabled: boolean;
  autoPrintCopies: number;
  cutPaperEnabled: boolean;
  paperWidth: 58 | 80;
}

export type PostFinalizePrintAction = "print" | "close";

interface PrintConfigRow {
  impressao_automatica?: number | null;
  impressao_vias?: number | null;
  impressao_corte?: number | null;
  impressao_largura_mm?: number | null;
}

export function normalizePrintConfigRow(row: PrintConfigRow): PrintConfig {
  return {
    autoPrintEnabled: row.impressao_automatica === 1,
    autoPrintCopies: Math.max(1, Number(row.impressao_vias ?? 1) || 1),
    cutPaperEnabled: row.impressao_corte === 1,
    paperWidth: Number(row.impressao_largura_mm) === 80 ? 80 : 58,
  };
}

export function getAutoPrintCopies(config: PrintConfig) {
  return config.autoPrintEnabled ? config.autoPrintCopies : 0;
}

export function getManualPrintCopies() {
  return 1;
}

export function shouldOfferPostFinalizePrint(config: PrintConfig) {
  return config.autoPrintEnabled;
}

export function getPostFinalizePrintDefaultAction(): PostFinalizePrintAction {
  return "print";
}

export function getPostFinalizePrintNextAction(
  current: PostFinalizePrintAction,
  key: "ArrowLeft" | "ArrowRight",
): PostFinalizePrintAction {
  if (key === "ArrowLeft") return "close";
  if (key === "ArrowRight") return "print";
  return current;
}

export function getNextRecentSaleIndex(
  currentIndex: number,
  key: "ArrowUp" | "ArrowDown",
  total: number,
) {
  if (total <= 0) return 0;
  if (key === "ArrowDown") return Math.min(currentIndex + 1, total - 1);
  return Math.max(currentIndex - 1, 0);
}
