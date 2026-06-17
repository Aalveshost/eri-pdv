import { describe, expect, it } from "vitest";
import { buildHistoricoPrintText } from "./historicoActions";

describe("historico print text", () => {
  it("prints the new 80mm layout with store data, item total, payment block and centered footer", () => {
    const text = buildHistoricoPrintText({
      titulo: "John Salgados",
      subtitulo: "Venda #360",
      dataVenda: "12/06/2026, 14:56:38",
      total: 15,
      itens: [
        {
          descricao: "Coxinha Costela Requeijao",
          quantidade: 2,
          valorUnitario: 5,
          valorTotal: 10,
        },
        {
          descricao: "Sprite Lata 350ml",
          quantidade: 1,
          valorUnitario: 5,
          valorTotal: 5,
        },
      ],
      paymentDetails: ["Dinheiro: R$ 20,00", "Troco: R$ 5,00"],
      enderecoLoja: "R. das Flores, 123",
      celularLoja: "(11) 9 9999-9999",
      instagramLoja: "@johnsalgados",
    }, 80);

    expect(text.startsWith("\n\n\n\n\nJohn Salgados")).toBe(true);
    expect(text).toContain("Rua: R. das Flores, 123");
    expect(text).toContain("Celular: (11) 9 9999-9999");
    expect(text).toContain("Instagram: @johnsalgados");
    expect(text).toContain("\n\nVenda #360\nData: 12/06/2026, 14:56:38");
    expect(text).toContain("QTD ITEM");
    expect(text).toContain("UNIT");
    expect(text).toContain("TOTAL");
    expect(text).toContain("Total de itens: 3");
    expect(text).toMatch(/Pagamento:\n- Dinheiro: R\$ 20,00\n- Troco: R\$ 5,00\nTotal: R\$ 15,00/);
    expect(text).toMatch(/-+\n\s+Obrigado pela preferencia!\n\s+Volte sempre!\n\n\n\n\n$/);
  });

  it("omits empty optional store fields and keeps the sale header separated by one blank line", () => {
    const text = buildHistoricoPrintText({
      titulo: "John Salgados",
      subtitulo: "Venda #361",
      dataVenda: "12/06/2026, 15:00:00",
      total: 8,
      itens: [
        {
          descricao: "Coxinha Frango",
          quantidade: 1,
          valorUnitario: 8,
          valorTotal: 8,
        },
      ],
      paymentDetails: ["PIX: R$ 8,00"],
      enderecoLoja: "",
      celularLoja: "",
      instagramLoja: "",
    }, 80);

    expect(text).not.toContain("Rua:");
    expect(text).not.toContain("Celular:");
    expect(text).not.toContain("Instagram:");
    expect(text).toContain("John Salgados\n\nVenda #361\nData: 12/06/2026, 15:00:00");
  });

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

  it("prints the payment block for single-payment sales too", () => {
    const text = buildHistoricoPrintText({
      titulo: "Venda #11",
      subtitulo: "Pagamento simples",
      dataVenda: "04/06/2026 14:05",
      total: 13.5,
      itens: [
        {
          descricao: "Sprite Lata 350ml",
          quantidade: 1,
          valorUnitario: 5.5,
          valorTotal: 5.5,
        },
      ],
      paymentDetails: ["Pix: R$ 13,50"],
    });

    expect(text).toContain("Pagamento:");
    expect(text).toContain("- Pix: R$ 13,50");
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

    expect(text.startsWith("\n\n\n\n\nJohn Salgados")).toBe(true);
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
    expect(text).toContain("Total de itens: 1");
    expect(text).toMatch(/Pagamento:\n- Dinheiro: R\$ 8,00\n- Credito: R\$ 8,00\nTotal: R\$ 16,00\n-+/);
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
