import { describe, expect, it, vi } from "vitest";
import {
  applyProdutoInactivationState,
  inactivateProdutoById,
  getProdutoDeleteModalLabels,
} from "./produtosDeleteFlow";

describe("produtos delete flow", () => {
  it("uses inativar as the confirmation label", () => {
    expect(getProdutoDeleteModalLabels()).toEqual({
      cancel: "CANCELAR (ESC)",
      confirm: "INATIVAR",
    });
  });

  it("inactivates the selected product in the database", async () => {
    const execute = vi.fn().mockResolvedValue(undefined);

    await inactivateProdutoById({ execute }, 42);

    expect(execute).toHaveBeenCalledWith(
      "UPDATE produtos SET ativo = 0 WHERE id = $1",
      [42]
    );
  });

  it("removes the inactive product from the current list immediately", () => {
    expect(
      applyProdutoInactivationState(
        [
          { id: 1, nome: "COCA", ativo: 1 },
          { id: 2, nome: "FANTA", ativo: 1 },
          { id: 3, nome: "GUARANA", ativo: 1 },
        ],
        2
      )
    ).toEqual([
      { id: 1, nome: "COCA", ativo: 1 },
      { id: 3, nome: "GUARANA", ativo: 1 },
    ]);
  });
});
