import { describe, expect, it } from "vitest";
import { getCashPaymentSummary } from "./pdvCashFlow";

describe("pdv cash flow", () => {
  it("calculates change when paid amount is greater than total", () => {
    expect(getCashPaymentSummary(17.51, 20)).toEqual({
      isEnough: true,
      troco: 2.49,
      falta: 0,
    });
  });

  it("shows missing amount when paid amount is lower than total", () => {
    expect(getCashPaymentSummary(17.51, 10)).toEqual({
      isEnough: false,
      troco: 0,
      falta: 7.51,
    });
  });
});
