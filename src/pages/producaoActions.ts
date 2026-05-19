export interface ProducaoEditLot {
  id: number;
  qtd_produzida: number;
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
