import { formatDkk, formatKroner } from '../shared/money.js';
import { EDITION_SIZE } from '../shared/copy.js';

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (character) => {
    if (character === '&') return '&amp;';
    if (character === '<') return '&lt;';
    if (character === '>') return '&gt;';
    return '&quot;';
  });
}

const PAGE_STYLE = `
  @page { margin: 18mm; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #0b1020; }
  h1 { font-size: 26pt; margin: 0 0 4mm; letter-spacing: 0.04em; }
  h2 { font-size: 13pt; font-weight: normal; margin: 0 0 8mm; color: #4a4f5c; }
  p { font-size: 11pt; line-height: 1.6; margin: 0 0 2mm; }
  .line { font-size: 9pt; white-space: nowrap; margin: 0 0 1.2mm; }
  .totals { margin-top: 6mm; font-size: 11pt; }
  img.plate { width: 70mm; height: 70mm; object-fit: contain; margin: 6mm 0; }
`;

export interface CertificateFacts {
  boxNumber: number;
  plate: string;
  reference: string;
  charityOre: number;
  artDataUri: string | null;
}

export function certificateHtml(facts: CertificateFacts): string {
  const art =
    facts.artDataUri === null
      ? ''
      : `<img class="plate" src="${facts.artDataUri}" alt="Plate ${escapeHtml(facts.plate)}">`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${PAGE_STYLE}</style></head><body>
<h1>Svovlstik Press</h1>
<h2>The Last Bundle</h2>
<p>Box ${facts.boxNumber} of ${EDITION_SIZE}</p>
<p>Plate: ${escapeHtml(facts.plate)}</p>
<p>Order ${escapeHtml(facts.reference)}</p>
<p>Charity share of this box: DKK ${formatKroner(facts.charityOre)}</p>
${art}
</body></html>`;
}

export interface StatementLine {
  reference: string;
  boxNumber: number;
  kind: 'sale' | 'refund';
  grossOre: number;
  netOre: number;
  vatOre: number;
  charityOre: number;
  makerOre: number;
  rateBasisPoints: number;
  postedAt: string;
}

export interface StatementFacts {
  month: string;
  revision: number;
  charityName: string;
  lines: StatementLine[];
  charityTotalOre: number;
}

/** One unbroken line of text per sale or refund, as published. */
export function statementLineText(line: StatementLine): string {
  return [
    `Box ${line.boxNumber}`,
    line.reference,
    line.kind,
    `gross ${formatDkk(line.grossOre)}`,
    `net ${formatDkk(line.netOre)}`,
    `VAT ${formatDkk(line.vatOre)}`,
    `charity ${formatDkk(line.charityOre)}`,
    `maker ${formatDkk(line.makerOre)}`,
  ].join(' ');
}

export function statementHtml(facts: StatementFacts): string {
  const lines = facts.lines
    .map((line) => `<p class="line">${escapeHtml(statementLineText(line))}</p>`)
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${PAGE_STYLE}</style></head><body>
<h1>Charity statement ${escapeHtml(facts.month)}</h1>
<h2>Revision ${facts.revision}</h2>
<p>${escapeHtml(facts.charityName)}</p>
${lines}
<p class="totals">Total charity share: ${formatDkk(facts.charityTotalOre)}</p>
</body></html>`;
}
