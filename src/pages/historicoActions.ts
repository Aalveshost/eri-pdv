export type HistoricoAction = "imprimir" | "excluir";
export type HistoricoActionTargetKind = "todas" | "prazo";

export interface HistoricoPrintItem {
  descricao: string;
  quantidade: number;
  valorUnitario?: number;
  valorTotal: number;
}

export interface HistoricoPrintPayload {
  titulo: string;
  subtitulo: string;
  dataVenda: string;
  total: number;
  itens: HistoricoPrintItem[];
  paymentDetails?: string[];
}

export type HistoricoPaperWidth = 58 | 80;

export interface HistoricoActionMeta {
  titulo: string;
  descricao: string;
}

export function getHistoricoActions(): HistoricoAction[] {
  return ["imprimir", "excluir"];
}

export function getNextHistoricoAction(current: HistoricoAction, key: "ArrowUp" | "ArrowDown") {
  if (key === "ArrowDown") {
    return current === "imprimir" ? "excluir" : "imprimir";
  }

  return current === "excluir" ? "imprimir" : "excluir";
}

export function getHistoricoDeleteConfirmText(descricao: string) {
  return `Excluir ${descricao}? Esta acao nao pode ser desfeita.`;
}

export function getHistoricoActionMeta(kind: HistoricoActionTargetKind, id: number): HistoricoActionMeta {
  if (kind === "prazo") {
    return {
      titulo: `Venda a Prazo #${id}`,
      descricao: `a venda a prazo #${id}`,
    };
  }

  return {
    titulo: `Venda #${id}`,
    descricao: `a venda #${id}`,
  };
}

export function buildHistoricoPrintHtml(payload: HistoricoPrintPayload) {
  const itensRows = payload.itens.map((item) => `
    <tr>
      <td>${item.descricao}</td>
      <td style="text-align:center">${item.quantidade}x</td>
      <td style="text-align:right">R$ ${formatMoney(item.valorUnitario ?? item.valorTotal)}</td>
      <td style="text-align:right">R$ ${formatMoney(item.valorTotal)}</td>
    </tr>
  `).join("") || `<tr><td colspan="4" style="color:#777">Nenhum item encontrado</td></tr>`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;background:#fff;color:#111;padding:28px}
    h1{font-size:20px;font-weight:800;margin-bottom:4px}
    .sub{font-size:12px;color:#555;margin-bottom:16px}
    .meta{font-size:12px;color:#333;margin-bottom:16px}
    table{width:100%;border-collapse:collapse}
    th,td{padding:8px 6px;border-bottom:1px solid #ddd;font-size:12px}
    th{text-transform:uppercase;font-size:10px;color:#666;text-align:left}
    .total{margin-top:16px;text-align:right;font-size:15px;font-weight:800}
    .actions{margin-top:18px;display:flex;justify-content:flex-end}
    button{padding:10px 18px;border:none;border-radius:8px;background:#111;color:#fff;font-weight:700;cursor:pointer}
    @media print{.actions{display:none} body{padding:16px}}
  </style></head><body>
    <h1>${payload.titulo}</h1>
    <p class="sub">${payload.subtitulo}</p>
    <p class="meta">Data: ${payload.dataVenda}</p>
    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th style="text-align:center">Qtd</th>
          <th style="text-align:right">Unitario</th>
          <th style="text-align:right">Total</th>
        </tr>
      </thead>
      <tbody>${itensRows}</tbody>
    </table>
    <p class="total">Total: R$ ${formatMoney(payload.total)}</p>
    <div class="actions">
      <button onclick="window.print()">Imprimir</button>
    </div>
  </body></html>`;
}

export function buildHistoricoPrintText(payload: HistoricoPrintPayload, paperWidth: HistoricoPaperWidth = 58) {
  const sep = "-".repeat(paperWidth === 80 ? 48 : 32);
  const paymentDetails = payload.paymentDetails && payload.paymentDetails.length > 0
    ? ["Pagamentos:", ...payload.paymentDetails].join("\n")
    : null;
  const itens = payload.itens.length > 0
    ? payload.itens.map((item) => {
        const unit = formatMoney(item.valorUnitario ?? item.valorTotal);
        const total = formatMoney(item.valorTotal);
        return `${item.quantidade}x ${item.descricao}\n  Unit.: R$ ${unit} | Total: R$ ${total}`;
      }).join("\n")
    : "Nenhum item encontrado";

  return [
    payload.titulo,
    payload.subtitulo,
    `Data: ${payload.dataVenda}`,
    sep,
    paymentDetails,
    paymentDetails ? sep : null,
    itens,
    sep,
    `Total: R$ ${formatMoney(payload.total)}`,
  ].filter(Boolean).join("\n");
}

function formatMoney(value: number) {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
