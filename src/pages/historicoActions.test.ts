import { describe, expect, it } from "vitest";
import { buildHistoricoPrintHtml, buildHistoricoPrintText, getHistoricoActionMeta, getHistoricoActions, getHistoricoDeleteConfirmText, getNextHistoricoAction } from "./historicoActions";

describe("historico actions", () => {
  it("exposes the allowed row actions", () => {
    expect(getHistoricoActions()).toEqual(["imprimir", "excluir"]);
  });

  it("moves between actions with arrow up and down", () => {
    expect(getNextHistoricoAction("imprimir", "ArrowDown")).toBe("excluir");
    expect(getNextHistoricoAction("excluir", "ArrowDown")).toBe("imprimir");
    expect(getNextHistoricoAction("excluir", "ArrowUp")).toBe("imprimir");
    expect(getNextHistoricoAction("imprimir", "ArrowUp")).toBe("excluir");
  });

  it("builds a destructive delete confirmation message", () => {
    expect(getHistoricoDeleteConfirmText("a venda #15")).toBe(
      "Excluir a venda #15? Esta acao nao pode ser desfeita."
    );
  });

  it("builds action metadata for normal and prazo sales", () => {
    expect(getHistoricoActionMeta("todas", 15)).toEqual({
      titulo: "Venda #15",
      descricao: "a venda #15",
    });

    expect(getHistoricoActionMeta("prazo", 8)).toEqual({
      titulo: "Venda a Prazo #8",
      descricao: "a venda a prazo #8",
    });
  });

  it("builds printable html with sale data and totals", () => {
    const html = buildHistoricoPrintHtml({
      titulo: "Venda #15",
      subtitulo: "Pagamento em Dinheiro",
      dataVenda: "19/05/2026 12:24",
      total: 35.02,
      itens: [
        {
          descricao: "COCA COLA 350ML",
          quantidade: 1,
          valorUnitario: 10,
          valorTotal: 10,
        },
      ],
    });

    expect(html).toContain("Venda #15");
    expect(html).toContain("Pagamento em Dinheiro");
    expect(html).toContain("COCA COLA 350ML");
    expect(html).toContain("19/05/2026 12:24");
    expect(html).toContain("Total: R$ 35,02");
  });

  it("builds printable text for direct default-printer output", () => {
    const text = buildHistoricoPrintText({
      titulo: "Venda #15",
      subtitulo: "Pagamento em Dinheiro",
      dataVenda: "19/05/2026 12:24",
      total: 35.02,
      itens: [
        {
          descricao: "COCA COLA 350ML",
          quantidade: 1,
          valorUnitario: 10,
          valorTotal: 10,
        },
      ],
    });

    expect(text).toContain("Venda #15");
    expect(text).toContain("Pagamento em Dinheiro");
    expect(text).toContain("Data: 19/05/2026 12:24");
    expect(text).toContain("1x COCA COLA 350ML");
    expect(text).toContain("Total: R$ 35,02");
  });

  it("builds narrower text output for 58 mm and wider output for 80 mm", () => {
    const payload = {
      titulo: "Venda #15",
      subtitulo: "Pagamento em Dinheiro",
      dataVenda: "19/05/2026 12:24",
      total: 35.02,
      itens: [
        {
          descricao: "COCA COLA 350ML",
          quantidade: 1,
          valorUnitario: 10,
          valorTotal: 10,
        },
      ],
    };

    const text58 = buildHistoricoPrintText(payload, 58);
    const text80 = buildHistoricoPrintText(payload, 80);

    expect(text58).toContain("-".repeat(32));
    expect(text80).toContain("-".repeat(48));
  });
});
