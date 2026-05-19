type DeleteTargetKind = "todas" | "prazo";

interface DeletePlanVenda {
  id: number;
  metodo_pagamento: string;
  data_venda: string;
  total_venda: number;
}

interface DeletePlanPrazoRow {
  id: number;
  data_venda: string;
  total: number;
}

interface BuildDeletePlanInput {
  targetKind: DeleteTargetKind;
  venda?: DeletePlanVenda | null;
  prazoId?: number | null;
  prazoRows?: DeletePlanPrazoRow[];
}

export function buildHistoricoDeletePlan(input: BuildDeletePlanInput) {
  if (input.targetKind === "prazo") {
    return {
      deleteVendaId: null,
      deletePrazoIds: input.prazoId ? [input.prazoId] : [],
    };
  }

  const venda = input.venda;
  if (!venda) {
    return {
      deleteVendaId: null,
      deletePrazoIds: [],
    };
  }

  const isPrazo = venda.metodo_pagamento.toLowerCase() === "prazo";
  const deletePrazoIds = isPrazo
    ? (input.prazoRows ?? [])
        .filter((row) => row.data_venda === venda.data_venda && row.total === venda.total_venda)
        .map((row) => row.id)
    : [];

  return {
    deleteVendaId: venda.id,
    deletePrazoIds,
  };
}
