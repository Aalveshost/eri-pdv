import { describe, expect, it } from "vitest";
import { buildDashboardProductionStats } from "./dashboardProductionStats";

describe("dashboard production stats", () => {
  it("calculates produced quantity and leftovers for the selected range", () => {
    const result = buildDashboardProductionStats(
      [
        {
          id: 1,
          produto_id: 10,
          nome: "COCA COLA 2L",
          qtd: 35,
          data: "2026-06-06 14:15:00",
        },
        {
          id: 2,
          produto_id: 11,
          nome: "COCA COLA KS",
          qtd: 1,
          data: "2026-06-06 14:20:00",
        },
      ],
      [
        { produto_id: 10, total_vendido: 3 },
        { produto_id: 11, total_vendido: 0 },
      ],
    );

    expect(result.totalProduzido).toBe(36);
    expect(result.totalSobras).toBe(33);
    expect(result.lista).toEqual([
      {
        id: 2,
        nome: "COCA COLA KS",
        qtd: 1,
        data: "06/06/2026",
        hora: "14:20",
      },
      {
        id: 1,
        nome: "COCA COLA 2L",
        qtd: 35,
        data: "06/06/2026",
        hora: "14:15",
      },
    ]);
  });
});
