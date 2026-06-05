import Database from "@tauri-apps/plugin-sql";

interface ItemVendaInput {
  produtoId: number;
  quantidade: number;
  precoUnitario: number;
}

interface VendaPagamentoInput {
  method: string;
  amount: number;
  order: number;
}

/**
 * Processa a venda dando baixa nos lotes de produção.
 * Prioriza lotes produzidos na mesma data da venda (dataReferencia).
 */
export async function processarVendaFIFO(
  db: Database, 
  items: ItemVendaInput[], 
  metodoPagamento: string, 
  totalVenda: number,
  dataReferencia?: string, // Formato YYYY-MM-DD
  pagamentos: VendaPagamentoInput[] = []
) {
  try {
    const resVenda = await db.execute(
      "INSERT INTO vendas (total_venda, metodo_pagamento, data_venda) VALUES ($1, $2, $3)",
      [totalVenda, metodoPagamento, dataReferencia || new Date().toISOString()]
    );
    const vendaId = resVenda.lastInsertId;

    const pagamentosNormalizados = pagamentos.length > 0
      ? pagamentos
      : [{ method: metodoPagamento, amount: totalVenda, order: 0 }];

    for (const pagamento of pagamentosNormalizados) {
      await db.execute(
        "INSERT INTO venda_pagamentos (venda_id, metodo, valor, ordem) VALUES ($1, $2, $3, $4)",
        [vendaId, pagamento.method, pagamento.amount, pagamento.order],
      );
    }

    for (const item of itemVendaInputToArray(items)) {
      // 2. Buscar lotes de produção ativos para este produto
      // Ordenamos para que a data mais próxima da venda venha primeiro (prioridade para o mesmo dia)
      const lotes: any[] = await db.select(
        `SELECT * FROM lotes 
         WHERE produto_id = $1 
         AND status = 'ativo' 
         AND qtd_atual > 0 
         ORDER BY ABS(julianday(data_fabricacao) - julianday($2)) ASC, data_fabricacao DESC`,
        [item.produtoId, dataReferencia || new Date().toISOString().split('T')[0]]
      );

      let qtdFaltante = item.quantidade;

      for (const lote of lotes) {
        if (qtdFaltante <= 0) break;

        const qtdADeduzir = Math.min(lote.qtd_atual, qtdFaltante);
        
        // 3. Atualizar o lote de produção (qtd_atual e qtd_vendida)
        await db.execute(
          "UPDATE lotes SET qtd_atual = qtd_atual - $1, qtd_vendida = qtd_vendida + $1 WHERE id = $2",
          [qtdADeduzir, lote.id]
        );

        // 4. Registrar o item da venda com preço de custo do lote
        const custoUnitario = lote.preco_custo || 0;
        await db.execute(
          `INSERT INTO venda_itens (venda_id, produto_id, lote_id, quantidade, preco_unitario, preco_custo) 
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [vendaId, item.produtoId, lote.id, qtdADeduzir, item.precoUnitario, custoUnitario]
        );

        qtdFaltante -= qtdADeduzir;
      }

      if (qtdFaltante > 0) {
        console.warn(`Venda realizada sem estoque de produção para o produto ${item.produtoId}.`);
        // Opcional: Registrar mesmo assim com lote_id nulo para não perder a venda
        await db.execute(
          `INSERT INTO venda_itens (venda_id, produto_id, lote_id, quantidade, preco_unitario, preco_custo) 
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [vendaId, item.produtoId, null, qtdFaltante, item.precoUnitario, 0]
        );
      }
    }

    return { success: true, vendaId };
  } catch (err) {
    console.error("Erro ao processar venda integrada:", err);
    throw err;
  }
}

// Helper para garantir que os itens sejam tratados corretamente
function itemVendaInputToArray(items: any): ItemVendaInput[] {
  return Array.isArray(items) ? items : [];
}
