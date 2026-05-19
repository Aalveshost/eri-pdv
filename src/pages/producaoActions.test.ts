import { describe, expect, it } from "vitest";
import {
  getProducaoEditMinimumQuantity,
  getProducaoNextFocusKey,
  getProducaoMinimumQuantityMessage,
} from "./producaoActions";

describe("producao actions", () => {
  it("requires at least the sold quantity when there is only one lot", () => {
    expect(
      getProducaoEditMinimumQuantity(10, 5, [{ id: 10, qtd_produzida: 10 }])
    ).toBe(5);
  });

  it("discounts the production of other lots before calculating the minimum", () => {
    expect(
      getProducaoEditMinimumQuantity(10, 12, [
        { id: 10, qtd_produzida: 10 },
        { id: 11, qtd_produzida: 4 },
      ])
    ).toBe(8);
  });

  it("allows zero when the other lots already cover the sold quantity", () => {
    expect(
      getProducaoEditMinimumQuantity(10, 6, [
        { id: 10, qtd_produzida: 10 },
        { id: 11, qtd_produzida: 8 },
      ])
    ).toBe(0);
  });

  it("formats the minimum quantity message in portuguese", () => {
    expect(getProducaoMinimumQuantityMessage(3)).toBe(
      "A quantidade deve ser maior ou igual a 3."
    );
  });

  it("preserves the previous focus key when the current element has no stable key", () => {
    expect(getProducaoNextFocusKey(null, "lote-row-53")).toBe("lote-row-53");
    expect(getProducaoNextFocusKey("", "lote-row-53")).toBe("lote-row-53");
  });

  it("uses the current focus key when it exists", () => {
    expect(getProducaoNextFocusKey("btn-edit-53", "lote-row-53")).toBe(
      "btn-edit-53"
    );
  });
});
