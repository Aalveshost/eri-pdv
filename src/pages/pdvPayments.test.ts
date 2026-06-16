import { describe, expect, it } from "vitest";
import {
  buildPaymentDetailLines,
  getCheckoutPaymentsSummary,
  getResumoMetodoPagamento,
  normalizePaymentEntries,
} from "./pdvPayments";

describe("pdv mixed payments", () => {
  it("summarizes launched amount, remaining amount, and cash change", () => {
    const summary = getCheckoutPaymentsSummary(35.02, [
      { method: "credito", amount: 10 },
      { method: "debito", amount: 15 },
      { method: "dinheiro", amount: 15.02 },
    ]);

    expect(summary).toEqual({
      totalLancado: 40.02,
      restante: 0,
      troco: 5,
      isComplete: true,
    });
  });

  it("keeps incomplete sales blocked while amount is still missing", () => {
    const summary = getCheckoutPaymentsSummary(35.02, [
      { method: "credito", amount: 10 },
      { method: "debito", amount: 15 },
    ]);

    expect(summary).toEqual({
      totalLancado: 25,
      restante: 10.02,
      troco: 0,
      isComplete: false,
    });
  });

  it("uses the exact method for single-payment sales and misto for split payments", () => {
    expect(getResumoMetodoPagamento([{ method: "pix", amount: 35.02 }])).toBe("pix");
    expect(
      getResumoMetodoPagamento([
        { method: "credito", amount: 10 },
        { method: "debito", amount: 25.02 },
      ]),
    ).toBe("misto");
  });

  it("formats payment details in print-friendly order", () => {
    expect(
      buildPaymentDetailLines([
        { method: "credito", amount: 10 },
        { method: "debito", amount: 25.02 },
      ]),
    ).toEqual(["Credito: R$ 10,00", "Debito: R$ 25,02"]);
  });

  it("keeps prazo inside mixed sales and labels it correctly", () => {
    expect(
      getResumoMetodoPagamento([
        { method: "credito", amount: 10 },
        { method: "prazo", amount: 25.02 },
      ]),
    ).toBe("misto");

    expect(
      buildPaymentDetailLines([
        { method: "credito", amount: 10 },
        { method: "prazo", amount: 25.02 },
      ]),
    ).toEqual(["Credito: R$ 10,00", "A Prazo: R$ 25,02"]);
  });

  it("uses the cliente identification for prazo receipt lines when provided", () => {
    expect(
      buildPaymentDetailLines(
        [
          { method: "credito", amount: 10 },
          { method: "prazo", amount: 25.02 },
        ],
        { prazoLabel: "15 - Joao Silva" },
      ),
    ).toEqual(["Credito: R$ 10,00", "Crediario: 15 - Joao Silva"]);
  });

  it("drops zero or invalid launches before persisting", () => {
    expect(
      normalizePaymentEntries([
        { method: "credito", amount: 10 },
        { method: "debito", amount: 0 },
        { method: "pix", amount: -2 },
        { method: "dinheiro", amount: Number.NaN },
      ]),
    ).toEqual([{ method: "credito", amount: 10, order: 0 }]);
  });
});
