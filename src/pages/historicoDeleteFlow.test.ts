import { describe, expect, it } from "vitest";
import { buildHistoricoDeletePlan } from "./historicoDeleteFlow";

describe("historico delete flow", () => {
  it("also removes linked prazo rows when deleting a prazo sale from the vendas tab", () => {
    expect(
      buildHistoricoDeletePlan({
        targetKind: "todas",
        venda: {
          id: 53,
          metodo_pagamento: "prazo",
          data_venda: "2026-05-19T14:17:30",
          total_venda: 10,
        },
        prazoRows: [
          { id: 16, data_venda: "2026-05-19T14:17:30", total: 10 },
          { id: 17, data_venda: "2026-05-19T14:18:00", total: 10 },
        ],
      })
    ).toEqual({
      deleteVendaId: 53,
      deletePrazoIds: [16],
    });
  });

  it("keeps normal sales isolated when deleting from the vendas tab", () => {
    expect(
      buildHistoricoDeletePlan({
        targetKind: "todas",
        venda: {
          id: 52,
          metodo_pagamento: "pix",
          data_venda: "2026-05-19T12:30:01",
          total_venda: 10,
        },
        prazoRows: [{ id: 16, data_venda: "2026-05-19T14:17:30", total: 10 }],
      })
    ).toEqual({
      deleteVendaId: 52,
      deletePrazoIds: [],
    });
  });

  it("deletes only the selected prazo row inside the prazo tab", () => {
    expect(
      buildHistoricoDeletePlan({
        targetKind: "prazo",
        prazoId: 16,
      })
    ).toEqual({
      deleteVendaId: null,
      deletePrazoIds: [16],
    });
  });
});
