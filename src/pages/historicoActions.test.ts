import { describe, expect, it } from "vitest";
import { buildHistoricoPrintText } from "./historicoActions";

describe("historico print text", () => {
  it("prints payment details when a sale uses multiple payment methods", () => {
    const text = buildHistoricoPrintText({
      titulo: "Venda #10",
      subtitulo: "Pagamento misto",
      dataVenda: "04/06/2026 14:00",
      total: 35.02,
      itens: [
        {
          descricao: "Coxinha",
          quantidade: 2,
          valorUnitario: 5,
          valorTotal: 10,
        },
      ],
      paymentDetails: ["Credito: R$ 10,00", "Debito: R$ 25,02"],
    });

    expect(text).toContain("Pagamentos:");
    expect(text).toContain("Credito: R$ 10,00");
    expect(text).toContain("Debito: R$ 25,02");
  });
});
