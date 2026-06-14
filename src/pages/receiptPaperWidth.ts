export function getReceiptPrintableWidthMm(paperWidth: 58 | 80) {
  return paperWidth === 80 ? 72 : 48;
}

export function getReceiptLineWidthChars(paperWidth: 58 | 80) {
  return getReceiptPrintableWidthMm(paperWidth) === 72 ? 48 : 32;
}
