export interface ProducaoEditLot {
  id: number;
  qtd_produzida: number;
}

export interface ProducaoSummaryLot extends ProducaoEditLot {
  produto_id: number | null;
  produto_nome: string;
  data_producao: string;
  qtd_vendida: number;
  qtd_vendida_lote: number;
  sobra: number;
}

interface ProducaoGroupSummary {
  produto_nome: string;
  produto_id: number | null;
  total_produzido: number;
  total_vendido: number;
  total_vendido_limitado: number;
  total_sobra: number;
  lotes: ProducaoSummaryLot[];
}

interface ProducaoSummary {
  totalProduzido: number;
  totalVendido: number;
  totalVendidoLimitado: number;
  totalSobras: number;
  temExcessoVendido: boolean;
  groupedProducoes: Record<string, ProducaoGroupSummary>;
}

export function getProducaoEditMinimumQuantity(
  targetLoteId: number,
  totalVendidoDia: number,
  lotesDoProduto: ProducaoEditLot[]
) {
  const totalProduzidoOutrosLotes = lotesDoProduto
    .filter((lote) => lote.id !== targetLoteId)
    .reduce((acc, lote) => acc + lote.qtd_produzida, 0);

  return Math.max(0, totalVendidoDia - totalProduzidoOutrosLotes);
}

export function getProducaoMinimumQuantityMessage(minimoPermitido: number) {
  return `A quantidade deve ser maior ou igual a ${minimoPermitido}.`;
}

export function getProducaoNextFocusKey(
  currentFocusKey: string | null | undefined,
  previousFocusKey: string | null | undefined
) {
  return currentFocusKey || previousFocusKey || null;
}

export function getProducaoSummary(
  producoes: ProducaoSummaryLot[]
): ProducaoSummary {
  const groupedProducoes = producoes.reduce<Record<string, ProducaoGroupSummary>>(
    (acc, producao) => {
      const key = producao.produto_nome;

      if (!acc[key]) {
        acc[key] = {
          produto_nome: producao.produto_nome,
          produto_id: producao.produto_id,
          total_produzido: 0,
          total_vendido: producao.qtd_vendida,
          total_vendido_limitado: 0,
          total_sobra: 0,
          lotes: [],
        };
      }

      acc[key].total_produzido += producao.qtd_produzida;
      acc[key].total_vendido_limitado = Math.min(
        acc[key].total_vendido,
        acc[key].total_produzido
      );
      acc[key].total_sobra = Math.max(
        0,
        acc[key].total_produzido - acc[key].total_vendido_limitado
      );
      acc[key].lotes.push(producao);

      return acc;
    },
    {}
  );

  const groups = Object.values(groupedProducoes);
  const totalProduzido = groups.reduce(
    (acc, group) => acc + group.total_produzido,
    0
  );
  const totalVendido = groups.reduce((acc, group) => acc + group.total_vendido, 0);
  const totalSobras = groups.reduce((acc, group) => acc + group.total_sobra, 0);

  return {
    totalProduzido,
    totalVendido,
    totalVendidoLimitado: Math.min(totalVendido, totalProduzido),
    totalSobras,
    temExcessoVendido: totalVendido > totalProduzido,
    groupedProducoes,
  };
}
