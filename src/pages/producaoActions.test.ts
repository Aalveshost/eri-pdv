import { describe, expect, it } from "vitest";
import {
  getProducaoEditMinimumQuantity,
  getProducaoNextFocusKey,
  getProducaoMinimumQuantityMessage,
  getProducaoSummary,
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

  it("does not multiply the sold quantity when the same product has multiple lots in the day", () => {
    const summary = getProducaoSummary([
      {
        id: 1,
        produto_id: 99,
        produto_nome: "COCA COLA 2L",
        data_producao: "2026-06-06 14:15:00",
        qtd_produzida: 10,
        qtd_vendida: 3,
        qtd_vendida_lote: 3,
        sobra: 7,
      },
      {
        id: 2,
        produto_id: 99,
        produto_nome: "COCA COLA 2L",
        data_producao: "2026-06-06 14:16:00",
        qtd_produzida: 10,
        qtd_vendida: 3,
        qtd_vendida_lote: 0,
        sobra: 10,
      },
      {
        id: 3,
        produto_id: 99,
        produto_nome: "COCA COLA 2L",
        data_producao: "2026-06-06 14:17:00",
        qtd_produzida: 10,
        qtd_vendida: 3,
        qtd_vendida_lote: 0,
        sobra: 10,
      },
    ]);

    expect(summary.totalProduzido).toBe(30);
    expect(summary.totalVendido).toBe(3);
    expect(summary.totalVendidoLimitado).toBe(3);
    expect(summary.totalSobras).toBe(27);
    expect(summary.temExcessoVendido).toBe(false);
    expect(summary.groupedProducoes["COCA COLA 2L"]).toMatchObject({
      total_produzido: 30,
      total_vendido: 3,
      total_vendido_limitado: 3,
      total_sobra: 27,
    });
  });
});
