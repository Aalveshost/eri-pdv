import { getProducaoSummary } from "./producaoActions";

interface DashboardProductionRow {
  id: number;
  produto_id: number | null;
  nome: string;
  qtd: number;
  data: string;
}

interface DashboardSoldRow {
  produto_id: number;
  total_vendido: number;
}

function isoToBr(iso: string) {
  if (!iso) return "";
  const [datePart] = iso.split(" ");
  const [y, m, d] = datePart.split("-");
  return `${d}/${m}/${y}`;
}

function isoToTime(iso: string) {
  if (!iso || !iso.includes(" ")) return "--:--";
  return iso.split(" ")[1].slice(0, 5);
}

export function buildDashboardProductionStats(
  producoes: DashboardProductionRow[],
  vendas: DashboardSoldRow[],
) {
  const vendasMap: Record<number, number> = {};
  vendas.forEach((venda) => {
    if (venda.produto_id) {
      vendasMap[venda.produto_id] = Number(venda.total_vendido || 0);
    }
  });

  const summary = getProducaoSummary(
    producoes.map((producao) => ({
      id: producao.id,
      produto_id: producao.produto_id,
      produto_nome: producao.nome,
      data_producao: producao.data,
      qtd_produzida: Number(producao.qtd || 0),
      qtd_vendida: producao.produto_id ? (vendasMap[producao.produto_id] || 0) : 0,
      qtd_vendida_lote: 0,
      sobra: 0,
    })),
  );

  return {
    totalProduzido: summary.totalProduzido,
    totalSobras: summary.totalSobras,
    lista: [...producoes]
      .sort((a, b) => {
        if (a.data === b.data) return b.id - a.id;
        return a.data < b.data ? 1 : -1;
      })
      .map((producao) => ({
        id: producao.id,
        nome: producao.nome,
        qtd: Number(producao.qtd || 0),
        data: isoToBr(producao.data),
        hora: isoToTime(producao.data),
      })),
  };
}
