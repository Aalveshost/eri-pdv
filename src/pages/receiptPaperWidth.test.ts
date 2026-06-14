import { describe, expect, it } from "vitest";
import { getReceiptLineWidthChars, getReceiptPrintableWidthMm } from "./receiptPaperWidth";

describe("receipt printable width", () => {
  it("uses the printable area for 58mm and 80mm receipts", () => {
    expect(getReceiptPrintableWidthMm(58)).toBe(48);
    expect(getReceiptPrintableWidthMm(80)).toBe(72);
  });

  it("maps the printable width to the receipt character grid", () => {
    expect(getReceiptLineWidthChars(58)).toBe(32);
    expect(getReceiptLineWidthChars(80)).toBe(48);
  });
});
