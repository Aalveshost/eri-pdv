import { describe, expect, it } from "vitest";
import {
  getAutoPrintCopies,
  getManualPrintCopies,
  getNextRecentSaleIndex,
  normalizePrintConfigRow,
} from "./pdvPrintFlow";

describe("pdv print flow", () => {
  it("normalizes missing print settings with safe defaults", () => {
    expect(normalizePrintConfigRow({})).toEqual({
      autoPrintEnabled: false,
      autoPrintCopies: 1,
      cutPaperEnabled: false,
    });
  });

  it("normalizes persisted values from the database", () => {
    expect(
      normalizePrintConfigRow({
        impressao_automatica: 1,
        impressao_vias: 3,
        impressao_corte: 1,
      }),
    ).toEqual({
      autoPrintEnabled: true,
      autoPrintCopies: 3,
      cutPaperEnabled: true,
    });
  });

  it("never allows fewer than one automatic copy", () => {
    expect(
      normalizePrintConfigRow({
        impressao_automatica: 1,
        impressao_vias: 0,
      }),
    ).toEqual({
      autoPrintEnabled: true,
      autoPrintCopies: 1,
      cutPaperEnabled: false,
    });
  });

  it("returns automatic copy count only when auto print is enabled", () => {
    expect(
      getAutoPrintCopies({
        autoPrintEnabled: true,
        autoPrintCopies: 2,
        cutPaperEnabled: false,
      }),
    ).toBe(2);

    expect(
      getAutoPrintCopies({
        autoPrintEnabled: false,
        autoPrintCopies: 4,
        cutPaperEnabled: true,
      }),
    ).toBe(0);
  });

  it("keeps manual reprint fixed at one copy", () => {
    expect(getManualPrintCopies()).toBe(1);
  });

  it("moves through recent sales with arrow keys without leaving bounds", () => {
    expect(getNextRecentSaleIndex(0, "ArrowDown", 5)).toBe(1);
    expect(getNextRecentSaleIndex(4, "ArrowDown", 5)).toBe(4);
    expect(getNextRecentSaleIndex(4, "ArrowUp", 5)).toBe(3);
    expect(getNextRecentSaleIndex(0, "ArrowUp", 5)).toBe(0);
  });

  it("stays at zero when there are no recent sales", () => {
    expect(getNextRecentSaleIndex(0, "ArrowDown", 0)).toBe(0);
    expect(getNextRecentSaleIndex(0, "ArrowUp", 0)).toBe(0);
  });
});
