import { getReceiptLineWidthChars } from "./receiptPaperWidth";

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
  enderecoLoja?: string;
  celularLoja?: string;
  instagramLoja?: string;
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
  const storeMetaLines = [
    payload.enderecoLoja?.trim() ? `Rua: ${payload.enderecoLoja.trim()}` : null,
    payload.celularLoja?.trim() ? `Celular: ${payload.celularLoja.trim()}` : null,
    payload.instagramLoja?.trim() ? `Instagram: ${payload.instagramLoja.trim()}` : null,
  ].filter(Boolean);
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
    .store{font-size:12px;color:#333;line-height:1.4}
    .sub{font-size:12px;color:#555;margin-top:16px}
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
    ${storeMetaLines.length > 0 ? `<p class="store">${storeMetaLines.join("<br/>")}</p>` : ""}
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
  const lineWidth = getReceiptLineWidthChars(paperWidth);
  const sep = "-".repeat(lineWidth);
  const topMargin = Array.from({ length: 5 }, () => "");
  const bottomMargin = Array.from({ length: 5 }, () => "");
  const itemHeader = paperWidth === 80 ? format80mmHeader(lineWidth) : null;
  const storeLines = buildStoreHeaderLines(payload);
  const paymentLines = payload.paymentDetails && payload.paymentDetails.length > 0
    ? ["Pagamento:", ...payload.paymentDetails.map((detail) => `- ${detail}`)]
    : [];
  const itens = payload.itens.length > 0
    ? payload.itens.map((item) => formatPrintItem(item, paperWidth, lineWidth)).join("\n")
    : "Nenhum item encontrado";
  const totalItems = payload.itens.reduce((sum, item) => sum + Math.max(0, Number(item.quantidade) || 0), 0);
  const footerMessage = [
    centerText("Obrigado pela preferencia!", lineWidth),
    centerText("Volte sempre!", lineWidth),
  ];

  return [
    ...topMargin,
    ...storeLines,
    "",
    payload.subtitulo,
    `Data: ${payload.dataVenda}`,
    sep,
    itemHeader,
    itemHeader ? sep : null,
    itens,
    sep,
    `Total de itens: ${totalItems}`,
    "",
    ...paymentLines,
    `Total: R$ ${formatMoney(payload.total)}`,
    sep,
    ...footerMessage,
    ...bottomMargin,
  ].filter((line) => line !== null && line !== undefined).join("\n");
}

function buildStoreHeaderLines(payload: HistoricoPrintPayload) {
  return [
    payload.titulo,
    payload.enderecoLoja?.trim() ? `Rua: ${payload.enderecoLoja.trim()}` : null,
    payload.celularLoja?.trim() ? `Celular: ${payload.celularLoja.trim()}` : null,
    payload.instagramLoja?.trim() ? `Instagram: ${payload.instagramLoja.trim()}` : null,
  ].filter((line): line is string => Boolean(line));
}

function formatPrintItem(
  item: HistoricoPrintItem,
  paperWidth: HistoricoPaperWidth,
  lineWidth: number,
) {
  if (paperWidth === 80) {
    const { qtyWidth, itemWidth, unitWidth, totalWidth } = get80mmColumnWidths(lineWidth);
    const quantity = `${item.quantidade}x`.padEnd(qtyWidth);
    const unit = formatMoney(item.valorUnitario ?? item.valorTotal);
    const total = formatMoney(item.valorTotal);
    const description = truncateText(item.descricao, itemWidth);
    return [
      quantity,
      description.padEnd(itemWidth),
      unit.padStart(unitWidth),
      total.padStart(totalWidth),
    ].join(" ");
  }

  const unit = `Unit.: R$ ${formatMoney(item.valorUnitario ?? item.valorTotal)}`;
  const total = `Total: R$ ${formatMoney(item.valorTotal)}`;
  const descriptionLines = wrapText(`${item.quantidade}x ${item.descricao}`, lineWidth);
  return `${descriptionLines.join("\n")}\n  ${unit} | ${total}`;
}

function format80mmHeader(lineWidth: number) {
  const { qtyWidth, itemWidth, unitWidth, totalWidth } = get80mmColumnWidths(lineWidth);
  return [
    "QTD".padEnd(qtyWidth),
    "ITEM".padEnd(itemWidth),
    "UNIT".padStart(unitWidth),
    "TOTAL".padStart(totalWidth),
  ].join(" ");
}

function get80mmColumnWidths(lineWidth: number) {
  const qtyWidth = 3;
  const unitWidth = 6;
  const totalWidth = 6;
  const gapsWidth = 3;
  const itemWidth = Math.max(1, lineWidth - qtyWidth - unitWidth - totalWidth - gapsWidth);

  return {
    qtyWidth,
    itemWidth,
    unitWidth,
    totalWidth,
  };
}

function truncateText(text: string, maxWidth: number) {
  if (text.length <= maxWidth) return text;
  if (maxWidth <= 3) return text.slice(0, maxWidth);
  return `${text.slice(0, maxWidth - 3).trimEnd()}...`;
}

function centerText(text: string, lineWidth: number) {
  if (text.length >= lineWidth) return text;
  const leftPadding = Math.floor((lineWidth - text.length) / 2);
  return `${" ".repeat(leftPadding)}${text}`;
}

function wrapText(text: string, lineWidth: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (candidate.length <= lineWidth) {
      currentLine = candidate;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
      currentLine = "";
    }

    if (word.length <= lineWidth) {
      currentLine = word;
      continue;
    }

    let remaining = word;
    while (remaining.length > lineWidth) {
      lines.push(remaining.slice(0, lineWidth));
      remaining = remaining.slice(lineWidth);
    }
    currentLine = remaining;
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

function formatMoney(value: number) {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
