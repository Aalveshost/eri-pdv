import { describe, expect, it } from "vitest";
import { processarVendaFIFO } from "./fifoEngine";

interface FakeCall {
  sql: string;
  params?: unknown[];
}

function createFakeDb(options?: {
  failOnExecuteMatch?: string;
}) {
  const calls: FakeCall[] = [];
  let saleInsertId = 100;

  return {
    calls,
    db: {
      async execute(sql: string, params?: unknown[]) {
        calls.push({ sql, params });

        if (options?.failOnExecuteMatch && sql.includes(options.failOnExecuteMatch)) {
          throw new Error(`forced execute failure: ${options.failOnExecuteMatch}`);
        }

        if (sql === "INSERT INTO vendas (total_venda, metodo_pagamento, data_venda) VALUES ($1, $2, $3)") {
          return { lastInsertId: saleInsertId++ };
        }

        return { lastInsertId: 0 };
      },
      async select(sql: string) {
        calls.push({ sql });
        return [
          { id: 10, qtd_atual: 10, preco_custo: 2.5, data_fabricacao: "2026-06-16" },
        ];
      },
    },
  };
}

describe("fifoEngine transactions", () => {
  it("wraps the full sale flow in a transaction and commits on success", async () => {
    const { db, calls } = createFakeDb();

    await processarVendaFIFO(
      db as never,
      [{ produtoId: 1, quantidade: 2, precoUnitario: 8 }],
      "pix",
      16,
      "2026-06-16T18:00:00",
      [{ method: "pix", amount: 16, order: 0 }],
    );

    expect(calls[0]?.sql).toBe("BEGIN");
    expect(calls[calls.length - 1]?.sql).toBe("COMMIT");
    expect(calls.some((call) => call.sql.includes("INSERT INTO venda_itens"))).toBe(true);
  });

  it("rolls back when a step fails after creating the sale", async () => {
    const { db, calls } = createFakeDb({
      failOnExecuteMatch: "INSERT INTO venda_itens",
    });

    await expect(
      processarVendaFIFO(
        db as never,
        [{ produtoId: 1, quantidade: 2, precoUnitario: 8 }],
        "pix",
        16,
        "2026-06-16T18:00:00",
        [{ method: "pix", amount: 16, order: 0 }],
      ),
    ).rejects.toThrow("forced execute failure");

    expect(calls[0]?.sql).toBe("BEGIN");
    expect(calls[calls.length - 1]?.sql).toBe("ROLLBACK");
    expect(calls.some((call) => call.sql === "COMMIT")).toBe(false);
  });
});
