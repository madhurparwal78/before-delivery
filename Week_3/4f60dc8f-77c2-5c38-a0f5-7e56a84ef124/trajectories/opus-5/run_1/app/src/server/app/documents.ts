import { formatMoney, type CurrencyCode } from '../../shared/money.js';
import { FX_LINE_GBP, fxLineLocked, TIMES_SIGN } from '../../shared/format.js';
import type { QuoteView } from '../../shared/domain.js';

export type MoneyDocument = {
  heading: string;
  reference: string;
  brandName: string;
  currency: CurrencyCode;
  quoteLines: { description: string; amountMinor: bigint }[];
  subtotalMinor: bigint;
  vatMinor: bigint;
  totalMinor: bigint;
  fxLine: string;
  amountLabel: string;
  amountMinor: bigint;
  documentLines: { description: string; amountMinor: bigint }[];
};

export const lockedFxLine = (quote: QuoteView): string =>
  quote.currency === 'GBP'
    ? FX_LINE_GBP
    : fxLineLocked(quote.fx_rate, quote.fx_locked_at ?? new Date().toISOString());

export const moneyDocumentFor = (input: {
  heading: string;
  amountLabel: string;
  amountMinor: bigint;
  reference: string;
  brandName: string;
  quote: QuoteView;
  documentLines: { description: string; amountMinor: bigint }[];
}): MoneyDocument => ({
  heading: input.heading,
  reference: input.reference,
  brandName: input.brandName,
  currency: input.quote.currency,
  quoteLines: input.quote.lines.map((line) => ({
    description: `${line.title} ${TIMES_SIGN} ${line.quantity}`,
    amountMinor: BigInt(line.amount_minor),
  })),
  subtotalMinor: BigInt(input.quote.subtotal_minor),
  vatMinor: BigInt(input.quote.vat_minor),
  totalMinor: BigInt(input.quote.total_minor),
  fxLine: lockedFxLine(input.quote),
  amountLabel: input.amountLabel,
  amountMinor: input.amountMinor,
  documentLines: input.documentLines,
});

export const documentText = (document: MoneyDocument): string =>
  [
    document.heading,
    `Reference: ${document.reference}`,
    `Brand: ${document.brandName}`,
    '',
    ...document.documentLines.map((line) => `${line.description}: ${formatMoney(line.amountMinor, document.currency)}`),
    '',
    `${document.amountLabel}: ${formatMoney(document.amountMinor, document.currency)}`,
    '',
    'Quote',
    ...document.quoteLines.map((line) => `${line.description}: ${formatMoney(line.amountMinor, document.currency)}`),
    `Subtotal: ${formatMoney(document.subtotalMinor, document.currency)}`,
    `VAT (20%): ${formatMoney(document.vatMinor, document.currency)}`,
    `Total: ${formatMoney(document.totalMinor, document.currency)}`,
    document.fxLine,
    '',
  ].join('\n');

export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const documentHtml = (document: MoneyDocument): string => {
  const money = (amount: bigint): string => escapeHtml(formatMoney(amount, document.currency));
  const row = (description: string, amount: bigint): string =>
    `<tr><td>${escapeHtml(description)}</td><td class="n">${money(amount)}</td></tr>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(document.heading)}</title>
<style>
  body { font-family: Helvetica, Arial, sans-serif; color: #15161c; margin: 32px; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  .meta { color: #4a4b55; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  td { text-align: left; padding: 7px 0; border-bottom: 1px solid #d8d8dd; }
  td.n { text-align: right; font-variant-numeric: tabular-nums; }
  .total td { font-weight: 700; }
  .fx { color: #4a4b55; }
</style></head>
<body>
  <h1>${escapeHtml(document.heading)}</h1>
  <p class="meta">${escapeHtml(document.reference)} &middot; ${escapeHtml(document.brandName)}</p>
  <table><tbody>
    ${document.documentLines.map((line) => row(line.description, line.amountMinor)).join('\n    ')}
    <tr class="total"><td>${escapeHtml(document.amountLabel)}</td><td class="n">${money(document.amountMinor)}</td></tr>
  </tbody></table>
  <table><tbody>
    ${document.quoteLines.map((line) => row(line.description, line.amountMinor)).join('\n    ')}
    ${row('Subtotal', document.subtotalMinor)}
    ${row('VAT (20%)', document.vatMinor)}
    <tr class="total"><td>Total</td><td class="n">${money(document.totalMinor)}</td></tr>
  </tbody></table>
  <p class="fx">${escapeHtml(document.fxLine)}</p>
</body></html>`;
};
