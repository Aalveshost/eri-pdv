interface ProdutoDeleteDb {
  execute: (query: string, bindValues?: unknown[]) => Promise<unknown>;
}

interface ProdutoListItem {
  id: number;
  ativo?: number;
}

export function getProdutoDeleteModalLabels() {
  return {
    cancel: "CANCELAR (ESC)",
    confirm: "INATIVAR",
  };
}

export async function inactivateProdutoById(db: ProdutoDeleteDb, produtoId: number) {
  await db.execute("UPDATE produtos SET ativo = 0 WHERE id = $1", [produtoId]);
}

export function applyProdutoInactivationState<T extends ProdutoListItem>(
  produtos: T[],
  produtoId: number
) {
  return produtos.filter((produto) => produto.id !== produtoId);
}
