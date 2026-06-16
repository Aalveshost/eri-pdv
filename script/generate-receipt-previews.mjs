import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const rootDir = process.cwd();
const outputDir = path.join(rootDir, "docs", "previews");
const paperWidth = 80;
const lineWidth = 48;

const singlePaymentReceipt = buildHistoricoPrintText({
  titulo: "John Salgados",
  subtitulo: "Venda #412",
  dataVenda: "16/06/2026, 17:20:16",
  total: 24,
  itens: [
    { descricao: "COXINHA COSTELA REQUEIJAO", quantidade: 1, valorUnitario: 8, valorTotal: 8 },
    { descricao: "COXINHA FRANGO CATUPIRY", quantidade: 1, valorUnitario: 8, valorTotal: 8 },
    { descricao: "COXINHA CARNE SECA CATUPIRY", quantidade: 1, valorUnitario: 8, valorTotal: 8 },
  ],
}, paperWidth);

const mixedPaymentReceipt = buildHistoricoPrintText({
  titulo: "John Salgados",
  subtitulo: "Venda #413",
  dataVenda: "16/06/2026, 17:21:27",
  total: 21.5,
  itens: [
    { descricao: "COXINHA FRANGO", quantidade: 1, valorUnitario: 8, valorTotal: 8 },
    { descricao: "SPRITE LATA 350ML", quantidade: 1, valorUnitario: 5.5, valorTotal: 5.5 },
    { descricao: "KIBE RECHEADO ESPECIAL", quantidade: 1, valorUnitario: 8, valorTotal: 8 },
  ],
  paymentDetails: ["Credito: R$ 10,00", "Debito: R$ 11,50"],
}, paperWidth);

await fs.mkdir(outputDir, { recursive: true });

await Promise.all([
  writeReceiptPreview("cupom-80mm-pagamento-unico", singlePaymentReceipt),
  writeReceiptPreview("cupom-80mm-pagamento-misto", mixedPaymentReceipt),
]);

async function writeReceiptPreview(fileBaseName, receiptText) {
  const svgPath = path.join(outputDir, `${fileBaseName}.svg`);
  const pngPath = path.join(outputDir, `${fileBaseName}.png`);
  const svg = buildReceiptSvg(receiptText);

  await fs.writeFile(svgPath, svg, "utf8");
  await renderSvgToPng(svgPath, pngPath);
}

async function renderSvgToPng(svgPath, pngPath) {
  try {
    await execFileAsync("sips", ["-s", "format", "png", svgPath, "--out", pngPath]);
    return;
  } catch (error) {
    const fallbackDir = path.dirname(pngPath);
    await execFileAsync("qlmanage", ["-t", "-s", "2000", "-o", fallbackDir, svgPath]);
    const generatedPath = path.join(fallbackDir, `${path.basename(svgPath)}.png`);
    await fs.rename(generatedPath, pngPath);
  }
}

function buildReceiptSvg(receiptText) {
  const lines = receiptText.split("\n");
  const fontSize = 32;
  const lineHeight = 44;
  const horizontalPadding = 36;
  const topPadding = 132;
  const bottomPadding = 132;
  const longestLineLength = Math.max(...lines.map((line) => line.length), lineWidth);
  const contentWidth = longestLineLength * 26;
  const width = contentWidth + (horizontalPadding * 2);
  const height = topPadding + bottomPadding + (lines.length * lineHeight);
  const renderedLines = lines.map((line, index) => {
    const y = topPadding + ((index + 1) * lineHeight);
    return `  <text x="${horizontalPadding}" y="${y}" font-family="Menlo, Monaco, 'Courier New', monospace" font-size="${fontSize}" fill="#202020" xml:space="preserve">${escapeXml(line) || " "}</text>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#f8f8f3" />
  <rect x="10" y="10" width="${width - 20}" height="${height - 20}" rx="14" fill="#fffefb" stroke="#dad7cf" stroke-width="2" />
${renderedLines}
</svg>`;
}

function buildHistoricoPrintText(payload, width) {
  const sep = "-".repeat(getReceiptLineWidthChars(width));
  const itemHeader = width === 80 ? format80mmHeader(lineWidth) : null;
  const paymentDetails = payload.paymentDetails && payload.paymentDetails.length > 0
    ? ["Pagamento:", ...payload.paymentDetails.map((detail) => `- ${detail}`)].join("\n")
    : null;
  const itens = payload.itens.length > 0
    ? payload.itens.map((item) => formatPrintItem(item, width, lineWidth)).join("\n")
    : "Nenhum item encontrado";

  return [
    "",
    payload.titulo,
    payload.subtitulo,
    `Data: ${payload.dataVenda}`,
    sep,
    itemHeader,
    itemHeader ? sep : null,
    itens,
    sep,
    paymentDetails,
    paymentDetails ? sep : null,
    `Total: R$ ${formatMoney(payload.total)}`,
  ].filter((line) => line !== null && line !== undefined).join("\n");
}

function formatPrintItem(item, width, currentLineWidth) {
  if (width === 80) {
    const { qtyWidth, itemWidth, unitWidth, totalWidth } = get80mmColumnWidths(currentLineWidth);
    const quantity = `${item.quantidade}x`.padEnd(qtyWidth);
    const description = truncateText(item.descricao, itemWidth);
    const unit = formatMoney(item.valorUnitario ?? item.valorTotal);
    const total = formatMoney(item.valorTotal);
    return [
      quantity,
      description.padEnd(itemWidth),
      unit.padStart(unitWidth),
      total.padStart(totalWidth),
    ].join(" ");
  }

  return `${item.quantidade}x ${item.descricao}`;
}

function format80mmHeader(currentLineWidth) {
  const { qtyWidth, itemWidth, unitWidth, totalWidth } = get80mmColumnWidths(currentLineWidth);
  return [
    "QTD".padEnd(qtyWidth),
    "ITEM".padEnd(itemWidth),
    "UNIT".padStart(unitWidth),
    "TOTAL".padStart(totalWidth),
  ].join(" ");
}

function get80mmColumnWidths(currentLineWidth) {
  const qtyWidth = 3;
  const unitWidth = 6;
  const totalWidth = 6;
  const gapsWidth = 3;
  const itemWidth = Math.max(1, currentLineWidth - qtyWidth - unitWidth - totalWidth - gapsWidth);

  return { qtyWidth, itemWidth, unitWidth, totalWidth };
}

function truncateText(text, maxWidth) {
  if (text.length <= maxWidth) return text;
  if (maxWidth <= 3) return text.slice(0, maxWidth);
  return `${text.slice(0, maxWidth - 3).trimEnd()}...`;
}

function formatMoney(value) {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getReceiptLineWidthChars(width) {
  return width === 80 ? 48 : 32;
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}
