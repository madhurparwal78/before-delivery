import type { ReturnJson } from '../../shared/types.js';
import { dateLine, centralTimeLabel } from '../domain/labels.js';

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The packet page: the tile, the wordmark and the two typefaces at print sizes. */
export function renderPacketHtml(ret: ReturnJson, revision: number): string {
  const approved = ret.approvals.find((a) => a.action === 'approved');
  const lines: string[] = [];
  lines.push(`<h1 class="wordmark">Duefield</h1>`);
  lines.push(`<p class="meta">Duefield filing packet &middot; Packet revision ${revision}</p>`);
  lines.push(
    `<p class="meta">${esc(ret.client.name)} &middot; ${esc(ret.state_name)} (${esc(ret.state)}) &middot; ${esc(ret.period_label)}</p>`,
  );
  lines.push(`<p class="due">${esc(ret.due_line)}</p>`);
  if (ret.carried_from !== null) {
    lines.push(`<p class="due">Carried from ${esc(dateLine(ret.carried_from))}</p>`);
  }
  lines.push(
    `<p>Rule edition effective ${esc(ret.edition.effective_date)} &middot; Due day ${ret.edition.due_day} &middot; Reference rate ${esc(ret.edition.rate)}%</p>`,
  );
  lines.push(`<p>Gross sales ${esc(ret.gross_sales ?? '0.00')} &middot; Tax due ${esc(ret.tax_due ?? '0.00')}</p>`);
  if (approved !== undefined) {
    lines.push(
      `<p>Approved by ${esc(approved.by)} on ${esc(dateLine(approved.at.slice(0, 10)))}, ${esc(centralTimeLabel(new Date(approved.at)))} Central</p>`,
    );
  }
  if (ret.extension !== null) {
    lines.push(`<p>Extended to ${esc(dateLine(ret.due_date))}</p>`);
  }
  for (const amendment of ret.amendments) {
    lines.push(
      `<p>Amended: gross sales ${esc(amendment.original.gross_sales)} to ${esc(amendment.amended.gross_sales)}, tax due ${esc(amendment.original.tax_due)} to ${esc(amendment.amended.tax_due)}</p>`,
    );
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: A4; margin: 18mm 16mm; }
body { font-family: 'Plus Jakarta Sans', 'Helvetica Neue', Arial, sans-serif; color: #000; margin: 0; padding: 0; }
.wordmark { font-family: 'Tilt Warp', 'Plus Jakarta Sans', sans-serif; font-size: 34pt; margin: 0 0 6mm; }
.meta { font-size: 12pt; margin: 0 0 2mm; }
.due { font-size: 14pt; margin: 3mm 0; }
p { font-size: 11pt; margin: 1.5mm 0; }
</style></head><body>${lines.join('\n')}</body></html>`;
}
