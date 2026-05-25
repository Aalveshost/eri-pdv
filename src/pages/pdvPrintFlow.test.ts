import { describe, expect, it } from "vitest";
import {
  getAutoPrintCopies,
  getManualPrintCopies,
  getNextRecentSaleIndex,
  getPostFinalizePrintDefaultAction,
  getPostFinalizePrintNextAction,
  normalizePrintConfigRow,
  shouldOfferPostFinalizePrint,
} from "./pdvPrintFlow";

describe("pdv print flow", () => {
  it("normalizes missing print settings with safe defaults", () => {
    expect(normalizePrintConfigRow({})).toEqual({
      autoPrintEnabled: false,
      autoPrintCopies: 1,
      cutPaperEnabled: false,
      paperWidth: 58,
    });
  });

  it("normalizes persisted values from the database", () => {
    expect(
      normalizePrintConfigRow({
        impressao_automatica: 1,
        impressao_vias: 3,
        impressao_corte: 1,
        impressao_largura_mm: 80,
      }),
    ).toEqual({
      autoPrintEnabled: true,
      autoPrintCopies: 3,
      cutPaperEnabled: true,
      paperWidth: 80,
    });
  });

  it("never allows fewer than one automatic copy", () => {
    expect(
      normalizePrintConfigRow({
        impressao_automatica: 1,
        impressao_vias: 0,
        impressao_largura_mm: 99,
      }),
    ).toEqual({
      autoPrintEnabled: true,
      autoPrintCopies: 1,
      cutPaperEnabled: false,
      paperWidth: 58,
    });
  });

  it("returns automatic copy count only when auto print is enabled", () => {
    expect(
      getAutoPrintCopies({
        autoPrintEnabled: true,
        autoPrintCopies: 2,
        cutPaperEnabled: false,
        paperWidth: 58,
      }),
    ).toBe(2);

    expect(
      getAutoPrintCopies({
        autoPrintEnabled: false,
        autoPrintCopies: 4,
        cutPaperEnabled: true,
        paperWidth: 80,
      }),
    ).toBe(0);
  });

  it("keeps manual reprint fixed at one copy", () => {
    expect(getManualPrintCopies()).toBe(1);
  });

  it("offers post-finalize print confirmation only when auto print is enabled", () => {
    expect(
      shouldOfferPostFinalizePrint({
        autoPrintEnabled: true,
        autoPrintCopies: 1,
        cutPaperEnabled: false,
        paperWidth: 58,
      }),
    ).toBe(true);

    expect(
      shouldOfferPostFinalizePrint({
        autoPrintEnabled: false,
        autoPrintCopies: 3,
        cutPaperEnabled: true,
        paperWidth: 80,
      }),
    ).toBe(false);
  });

  it("defaults the post-finalize print action to print", () => {
    expect(getPostFinalizePrintDefaultAction()).toBe("print");
  });

  it("switches post-finalize print action with left and right arrows", () => {
    expect(getPostFinalizePrintNextAction("print", "ArrowLeft")).toBe("close");
    expect(getPostFinalizePrintNextAction("close", "ArrowRight")).toBe("print");
    expect(getPostFinalizePrintNextAction("print", "ArrowRight")).toBe("print");
    expect(getPostFinalizePrintNextAction("close", "ArrowLeft")).toBe("close");
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
