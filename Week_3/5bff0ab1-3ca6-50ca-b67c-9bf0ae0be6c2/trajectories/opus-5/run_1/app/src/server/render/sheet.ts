import {
  finish as finishDef,
  hub as hubDef,
  model as modelDef,
  type FinishId,
  type HubId,
  type ModelId,
} from '../../shared/catalogue.js';
import { formatPaise } from '../../shared/money.js';
import { istDate, labelDMonYear, labelHmm } from '../clock.js';
import type { LockRow } from '../domain/views.js';
import { escapeHtml } from './html.js';

/** The closing line is chosen by the lock's state when the render begins. */
function closingLine(row: LockRow): string {
  if (row.state === 'delivery_set' && row.delivery_date) {
    return `Delivery day ${labelDMonYear(row.delivery_date)}`;
  }
  const expiresAt = row.expires_at as Date;
  return `Valid until ${labelDMonYear(istDate(expiresAt))}, ${labelHmm(expiresAt)} IST`;
}

export function priceSheetHtml(row: LockRow, riderName: string): string {
  const rows: [string, string][] = [
    ['Ex-showroom', formatPaise(row.ex_showroom_paise)],
    ['Road tax', formatPaise(row.road_tax_paise)],
    ['Insurance', formatPaise(row.insurance_paise)],
    ['On-road', formatPaise(row.on_road_paise)],
  ];
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Price Sheet</title>
<style>
  body { font-family: Helvetica, Arial, sans-serif; color: #18191b; margin: 48px; }
  h1 { font-size: 28px; margin: 0 0 4px; }
  h2 { font-size: 18px; margin: 0 0 32px; font-weight: normal; }
  table { border-collapse: collapse; width: 100%; margin: 24px 0; }
  td { padding: 10px 0; }
  td.amount { text-align: right; }
  .closing { margin-top: 32px; font-size: 16px; }
  .detail { margin: 4px 0; }
</style></head>
<body>
  <h1>Malhar Motor Works</h1>
  <h2>Price Sheet</h2>
  <p class="detail">Rider: ${escapeHtml(riderName)}</p>
  <p class="detail">Machine: ${escapeHtml(modelDef(row.model as ModelId).name)}</p>
  <p class="detail">Finish: ${escapeHtml(finishDef(row.finish as FinishId).name)}</p>
  <p class="detail">Hub: ${escapeHtml(hubDef(row.hub as HubId).name)}</p>
  <p class="detail">Issued: ${labelDMonYear(istDate(row.issued_at))}, ${labelHmm(
    row.issued_at,
  )} IST</p>
  <table>
    ${rows
      .map(([label, amount]) => `<tr><td>${label}</td><td class="amount">${amount}</td></tr>`)
      .join('\n    ')}
  </table>
  <p class="closing">${escapeHtml(closingLine(row))}</p>
</body></html>`;
}
