import { formatMoney } from '../../shared/money.js';
import { ZONE_NAMES, type Zone } from '../../shared/countries.js';
import type { SettlementDto } from '../../shared/types.js';

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const PAPER = '#f2f6f3';
const INK = '#0c3b36';

const STYLE = `
  @page { size: A4; margin: 18mm; }
  * { box-sizing: border-box; }
  body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: ${INK};
    background: ${PAPER}; margin: 0; font-size: 11pt; line-height: 1.5; }
  h1 { font-size: 20pt; letter-spacing: 0.01em; margin: 0 0 4mm; }
  h2 { font-size: 13pt; margin: 8mm 0 3mm; }
  .line { white-space: nowrap; margin: 0 0 1.5mm; }
  .meta { margin: 0 0 1.5mm; }
  table { width: 100%; border-collapse: collapse; margin-top: 3mm; }
  th, td { border-bottom: 1px solid ${INK}; padding: 2mm 1mm; text-align: right;
    white-space: nowrap; font-size: 10pt; }
  th:first-child, td:first-child { text-align: left; }
  .cover { width: 70mm; height: 70mm; object-fit: contain; margin: 4mm 0; display: block; }
  .rule { border: 0; border-top: 2px solid ${INK}; margin: 6mm 0; }
  .total { font-weight: 700; }
`;

function page(title: string, inner: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>${STYLE}</style></head><body>${inner}</body></html>`;
}

export interface StatementData {
  readonly pledgeId: string;
  readonly campaignTitle: string;
  readonly backerName: string;
  readonly tierTitle: string;
  readonly zone: Zone;
  readonly reward: number;
  readonly shipping: number;
  readonly addOn: number;
  readonly amount: number;
  readonly platformFee: number;
  readonly processingFee: number;
  readonly toCreator: number;
  readonly coverDataUri: string | null;
}

export function statementHtml(data: StatementData): string {
  const cover =
    data.coverDataUri === null
      ? ''
      : `<img class="cover" src="${data.coverDataUri}" alt="Cover art for ${escapeHtml(data.campaignTitle)}">`;
  return page(
    'Dotgain backer statement',
    `<h1>Dotgain backer statement</h1>
<p class="meta">${escapeHtml(data.campaignTitle)}</p>
<p class="meta">${escapeHtml(data.backerName)}</p>
<p class="meta">Pledge ${escapeHtml(data.pledgeId)}</p>
<p class="meta">${escapeHtml(data.tierTitle)}</p>
${cover}
<hr class="rule">
<p class="line">Reward ${formatMoney(data.reward)}</p>
<p class="line">Shipping (${ZONE_NAMES[data.zone]}) ${formatMoney(data.shipping)}</p>
<p class="line">Add-on ${formatMoney(data.addOn)}</p>
<p class="line total">Total charged ${formatMoney(data.amount)}</p>
<hr class="rule">
<p class="line">Platform fee (5%) ${formatMoney(data.platformFee)}</p>
<p class="line">Processing (3% + 20p) ${formatMoney(data.processingFee)}</p>
<p class="line total">To the creator ${formatMoney(data.toCreator)}</p>`,
  );
}

export function settlementHtml(campaignTitle: string, settlement: SettlementDto): string {
  const rows = settlement.lines
    .map(
      (line) =>
        `<tr><td>${escapeHtml(line.pledge_id)}</td><td>${formatMoney(line.amount)}</td>` +
        `<td>${formatMoney(line.platform_fee)}</td><td>${formatMoney(line.processing_fee)}</td>` +
        `<td>${formatMoney(line.to_creator)}</td></tr>`,
    )
    .join('');
  return page(
    'Dotgain settlement sheet',
    `<h1>Dotgain settlement sheet</h1>
<p class="meta">${escapeHtml(campaignTitle)}</p>
<table><thead><tr><th>Pledge</th><th>Amount</th><th>Platform fee</th>
<th>Processing</th><th>To the creator</th></tr></thead><tbody>${rows}</tbody></table>
<hr class="rule">
<p class="line">Gross ${formatMoney(settlement.gross)}</p>
<p class="line">Platform fees ${formatMoney(settlement.platform_fee)}</p>
<p class="line">Processing fees ${formatMoney(settlement.processing_fee)}</p>
<p class="line total">Net to creator ${formatMoney(settlement.net)}</p>
<hr class="rule">
<p class="line">Captured pledges ${settlement.captured_count}</p>
<p class="line">Dropped pledges ${settlement.dropped_count}</p>`,
  );
}
