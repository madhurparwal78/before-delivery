import { EDITION } from "../shared/domain.js";
import { formatDkk } from "../shared/money.js";

/** HTML for the certificate and the charity statement; Gotenberg turns it into PDF. */

const escape = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const SHEET_CSS = `
  @page { size: A4; margin: 18mm; }
  body { font-family: Georgia, "Times New Roman", serif; color: #0a101c; background: #eaf0f8; margin: 0; }
  .sheet { border: 1px solid #6b7588; padding: 14mm; min-height: 240mm; }
  h1 { font-size: 30pt; font-weight: 400; margin: 0 0 4mm; }
  h2 { font-size: 18pt; font-weight: 400; margin: 0 0 8mm; color: #4a5568; }
  p { font-size: 13pt; margin: 3mm 0; white-space: nowrap; }
  img.art { display: block; max-width: 90mm; max-height: 90mm; margin: 8mm 0; border: 1px solid #6b7588; }
  .rule { border-top: 1px solid #6b7588; margin: 8mm 0; }
`;

const PLATE_DRAWING = `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="120" viewBox="0 0 260 120">
  <rect x="1" y="1" width="258" height="118" fill="none" stroke="#6b7588"/>
  <rect x="60" y="56" width="140" height="10" fill="#0a101c"/><circle cx="204" cy="61" r="9" fill="#0a101c"/></svg>`;

interface CertificateData {
  number: number;
  plate: string;
  reference: string;
  charityOre: number;
  art: { contentType: string; bytes: Buffer } | null;
}

export const certificateHtml = (data: CertificateData): string => `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${SHEET_CSS}</style></head>
<body><div class="sheet">
<h1>Svovlstik Press</h1><h2>The Last Bundle</h2>
<p>Box ${data.number} of ${EDITION}</p>
<p>Plate: ${escape(data.plate)}</p>
<p>Order ${escape(data.reference)}</p>
<div class="rule"></div>
${data.art ? `<img class="art" alt="" src="data:${data.art.contentType};base64,${data.art.bytes.toString("base64")}">` : PLATE_DRAWING}
<p>Charity share of this box: ${formatDkk(data.charityOre)}</p>
</div></body></html>`;

export interface StatementLine {
  reference: string;
  boxNumber: number;
  kind: "sale" | "refund";
  grossOre: number;
  netOre: number;
  vatOre: number;
  charityOre: number;
  makerOre: number;
}

interface StatementData {
  month: string;
  revision: number;
  charityName: string;
  lines: StatementLine[];
  charityTotalOre: number;
  makerTotalOre: number;
  vatTotalOre: number;
}

const lineText = (line: StatementLine): string =>
  `Box ${line.boxNumber} ${line.reference} ${line.kind} gross ${formatDkk(line.grossOre)} net ${formatDkk(line.netOre)} VAT ${formatDkk(line.vatOre)} charity ${formatDkk(line.charityOre)} maker ${formatDkk(line.makerOre)}`;

export const statementHtml = (data: StatementData): string => `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
  @page { size: A4 landscape; margin: 14mm; }
  body { font-family: Georgia, "Times New Roman", serif; color: #0a101c; margin: 0; }
  h1 { font-size: 24pt; font-weight: 400; margin: 0 0 2mm; }
  h2 { font-size: 13pt; font-weight: 400; margin: 0 0 6mm; color: #4a5568; }
  p { font-size: 9pt; margin: 1.6mm 0; white-space: nowrap; }
  p.total { font-size: 11pt; margin-top: 6mm; }
</style></head><body>
<h1>Charity statement ${escape(data.month)}</h1>
<h2>Revision ${data.revision}</h2>
<p>${escape(data.charityName)}</p>
${data.lines.map((line) => `<p>${escape(lineText(line))}</p>`).join("\n")}
<p class="total">Total charity share: ${formatDkk(data.charityTotalOre)}</p>
<p class="total">Total maker share: ${formatDkk(data.makerTotalOre)}</p>
<p class="total">Total VAT: ${formatDkk(data.vatTotalOre)}</p>
</body></html>`;
