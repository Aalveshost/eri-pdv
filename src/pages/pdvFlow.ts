export function formatDateBR(date: Date) {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

export function getTodayDigits(date: Date) {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = String(date.getFullYear());
  return d + m + y;
}

export function getPostFinalizeVendaState(now: Date) {
  return {
    stage: "selling" as const,
    vendaDate: formatDateBR(now),
    dateDigits: getTodayDigits(now),
  };
}

export function getCashCheckoutOpenState() {
  return {
    showCashConfirm: true,
    cashPaidInput: "0,00",
  };
}

export function getCashCheckoutCancelState() {
  return {
    stage: "checkout" as const,
    showCashConfirm: false,
    cashPaidInput: "0,00",
  };
}

export function getCheckoutDefaultSelection<T>(defaultSelection: T) {
  return defaultSelection;
}

export function getVendaSuccessToastTiming() {
  return {
    visibleMs: 1500,
    exitMs: 300,
  };
}
