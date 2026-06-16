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

    expect(text).toContain("Pagamento:");
    expect(text).toContain("- Credito: R$ 10,00");
    expect(text).toContain("- Debito: R$ 25,02");
  });

  it("uses the wider 80mm layout with a fixed header and aligned columns", () => {
    const text = buildHistoricoPrintText({
      titulo: "John Salgados",
      subtitulo: "Venda #360",
      dataVenda: "12/06/2026 - 14:56:38",
      total: 16,
      itens: [
        {
          descricao: "Coxinha Costela Requeijao",
          quantidade: 1,
          valorUnitario: 8,
          valorTotal: 8,
        },
      ],
      paymentDetails: ["Dinheiro: R$ 8,00", "Credito: R$ 8,00"],
    }, 80);

    expect(text.startsWith("\nJohn Salgados")).toBe(true);
    expect(text).toContain("John Salgados");
    expect(text).toContain("Venda #360");
    expect(text).toContain("Data: 12/06/2026 - 14:56:38");
    expect(text).toContain("QTD ITEM");
    expect(text).toContain("UNIT");
    expect(text).toContain("TOTAL");
    expect(text).toMatch(/1x\s+Coxinha Costela Requeij[a-z. ]+8,00\s+8,00/);
    expect(text).toContain("Pagamento:");
    expect(text).toContain("- Dinheiro: R$ 8,00");
    expect(text).toContain("- Credito: R$ 8,00");
    expect(text).toMatch(/Pagamento:\n- Dinheiro: R\$ 8,00\n- Credito: R\$ 8,00\n-+\nTotal: R\$ 16,00/);
  });

  it("truncates long item names in the 80mm one-line layout", () => {
    const text = buildHistoricoPrintText({
      titulo: "John Salgados",
      subtitulo: "Venda #361",
      dataVenda: "12/06/2026 - 14:56:38",
      total: 8,
      itens: [
        {
          descricao: "Coxinha Costela Requeijao Cremoso Especial",
          quantidade: 1,
          valorUnitario: 8,
          valorTotal: 8,
        },
      ],
    }, 80);

    expect(text).toContain("...");
    expect(text).toMatch(/1x\s+Coxinha Costela Re[a-zA-Z ]+\.\.\.\s+8,00\s+8,00/);
  });
});
