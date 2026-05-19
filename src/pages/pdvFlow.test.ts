import { describe, expect, it } from "vitest";
import { getCashCheckoutCancelState, getCashCheckoutOpenState, getCheckoutDefaultSelection, getPostFinalizeVendaState, getVendaSuccessToastTiming } from "./pdvFlow";

describe("pdv post-finalize flow", () => {
  it("returns directly to selling mode with today's date pre-confirmed", () => {
    const now = new Date("2026-05-19T14:33:21");

    expect(getPostFinalizeVendaState(now)).toEqual({
      stage: "selling",
      vendaDate: "19/05/2026",
      dateDigits: "19052026",
    });
  });

  it("opens the cash dialog with the paid amount reset", () => {
    expect(getCashCheckoutOpenState()).toEqual({
      showCashConfirm: true,
      cashPaidInput: "0,00",
    });
  });

  it("cancels the cash dialog without leaving checkout and clears the paid amount", () => {
    expect(getCashCheckoutCancelState()).toEqual({
      stage: "checkout",
      showCashConfirm: false,
      cashPaidInput: "0,00",
    });
  });

  it("defaults a new checkout flow to dinheiro", () => {
    expect(getCheckoutDefaultSelection("dinheiro")).toBe("dinheiro");
  });

  it("uses the configured success toast timing", () => {
    expect(getVendaSuccessToastTiming()).toEqual({
      visibleMs: 1500,
      exitMs: 300,
    });
  });
});
