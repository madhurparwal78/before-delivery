import type { StatementLine } from '../../shared/api.js';
import { formatPeriod, formatUsd } from '../../shared/money.js';

const PLATFORM = 'Brightmoss Works';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: #15130f; margin: 48px; font-size: 12px; }
  h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: -0.01em; }
  h2 { font-size: 13px; margin: 28px 0 6px; text-transform: uppercase; letter-spacing: 0.08em; color: #5d574c; }
  .muted { color: #5d574c; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { text-align: left; padding: 7px 0; border-bottom: 1px solid #ddd8cd; }
  td.amount, th.amount { text-align: right; font-variant-numeric: tabular-nums; }
  .totals td { border: none; padding: 3px 0; }
  .totals tr.grand td { border-top: 1.5px solid #15130f; font-weight: 700; padding-top: 8px; }
  .party { display: flex; gap: 48px; margin-top: 20px; }
  .party div { flex: 1; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function isoDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export interface InvoiceDocument {
  readonly invoiceNumber: string;
  readonly issuedAt: Date;
  readonly sellerName: string;
  readonly sellerAddress: string;
  readonly buyerName: string;
  readonly buyerEmail: string;
  readonly buyerCountry: string;
  readonly pieceTitle: string;
  readonly edition: number;
  readonly editionCount: number;
  readonly netCents: number;
  readonly vatRatePercent: number;
  readonly vatCents: number;
  readonly grossCents: number;
}

/** For a remix, the seller is the remixer. */
export function invoiceHtml(invoice: InvoiceDocument): string {
  const line = `${invoice.pieceTitle} \u2014 edition ${invoice.edition} of ${invoice.editionCount}`;
  return page(
    `Invoice ${invoice.invoiceNumber}`,
    `<h1>Invoice ${escapeHtml(invoice.invoiceNumber)}</h1>
<p class="muted">Issued ${isoDate(invoice.issuedAt)}</p>
<div class="party">
  <div>
    <h2>Seller</h2>
    <p>${escapeHtml(invoice.sellerName)}<br />${escapeHtml(invoice.sellerAddress)}</p>
    <p class="muted">Sold through Phosphene Yard by ${PLATFORM}</p>
  </div>
  <div>
    <h2>Billed to</h2>
    <p>${escapeHtml(invoice.buyerName)}<br />${escapeHtml(invoice.buyerEmail)}<br />${escapeHtml(invoice.buyerCountry)}</p>
  </div>
</div>
<h2>Edition</h2>
<table>
  <thead><tr><th>Item</th><th class="amount">Amount</th></tr></thead>
  <tbody><tr><td>${escapeHtml(line)}</td><td class="amount">$${formatUsd(invoice.netCents)}</td></tr></tbody>
</table>
<table class="totals">
  <tbody>
    <tr><td>Net</td><td class="amount">$${formatUsd(invoice.netCents)}</td></tr>
    <tr><td>VAT ${invoice.vatRatePercent}%</td><td class="amount">$${formatUsd(invoice.vatCents)}</td></tr>
    <tr class="grand"><td>Total USD</td><td class="amount">$${formatUsd(invoice.grossCents)}</td></tr>
  </tbody>
</table>`,
  );
}

export interface CreditNoteDocument {
  readonly creditNoteNumber: string;
  readonly invoiceNumber: string;
  readonly issuedAt: Date;
  readonly sellerName: string;
  readonly sellerAddress: string;
  readonly buyerName: string;
  readonly pieceTitle: string;
  readonly edition: number;
  readonly editionCount: number;
  readonly netCents: number;
  readonly vatRatePercent: number;
  readonly vatCents: number;
  readonly grossCents: number;
}

export function creditNoteHtml(note: CreditNoteDocument): string {
  const line = `${note.pieceTitle} \u2014 edition ${note.edition} of ${note.editionCount}`;
  return page(
    `Credit note ${note.creditNoteNumber}`,
    `<h1>Credit note ${escapeHtml(note.creditNoteNumber)}</h1>
<p class="muted">Refers to invoice ${escapeHtml(note.invoiceNumber)}</p>
<p class="muted">Issued ${isoDate(note.issuedAt)}</p>
<div class="party">
  <div>
    <h2>Seller</h2>
    <p>${escapeHtml(note.sellerName)}<br />${escapeHtml(note.sellerAddress)}</p>
    <p class="muted">Sold through Phosphene Yard by ${PLATFORM}</p>
  </div>
  <div>
    <h2>Credited to</h2>
    <p>${escapeHtml(note.buyerName)}</p>
  </div>
</div>
<h2>Credited</h2>
<table>
  <thead><tr><th>Item</th><th class="amount">Amount</th></tr></thead>
  <tbody><tr><td>${escapeHtml(line)}</td><td class="amount">$${formatUsd(note.netCents)}</td></tr></tbody>
</table>
<table class="totals">
  <tbody>
    <tr><td>Credited net</td><td class="amount">$${formatUsd(note.netCents)}</td></tr>
    <tr><td>VAT ${note.vatRatePercent}%</td><td class="amount">$${formatUsd(note.vatCents)}</td></tr>
    <tr class="grand"><td>Credited total USD</td><td class="amount">$${formatUsd(note.grossCents)}</td></tr>
  </tbody>
</table>`,
  );
}

const LINE_KIND_LABELS: Readonly<Record<StatementLine['kind'], string>> = {
  sale: 'Sale',
  remix_sale: 'Remix sale',
  royalty: 'Royalty',
  refund: 'Refund',
};

export interface StatementDocument {
  readonly period: string;
  readonly creatorName: string;
  readonly lines: readonly StatementLine[];
  readonly totalCents: number;
}

/** The statement never shows buyer emails, billing countries or invoice numbers. */
export function statementHtml(statement: StatementDocument): string {
  const rows = statement.lines
    .map(
      (line) =>
        `<tr><td>${line.date}</td><td>${escapeHtml(line.piece_title)}</td><td>${line.edition}</td><td>${LINE_KIND_LABELS[line.kind]}</td><td class="amount">${line.amount_cents < 0 ? '\u2212' : '+'}$${formatUsd(Math.abs(line.amount_cents))}</td></tr>`,
    )
    .join('\n');

  return page(
    `Statement ${formatPeriod(statement.period)}`,
    `<h1>Statement ${escapeHtml(formatPeriod(statement.period))}</h1>
<p class="muted">${escapeHtml(statement.creatorName)}</p>
<p class="muted">Paid through Phosphene Yard by ${PLATFORM}</p>
<table>
  <thead><tr><th>Date</th><th>Piece</th><th>Edition</th><th>Kind</th><th class="amount">Amount</th></tr></thead>
  <tbody>
${rows === '' ? '<tr><td colspan="5" class="muted">No lines in this month.</td></tr>' : rows}
  </tbody>
</table>
<table class="totals">
  <tbody>
    <tr class="grand"><td>Total USD</td><td class="amount">${statement.totalCents < 0 ? '\u2212' : '+'}$${formatUsd(Math.abs(statement.totalCents))}</td></tr>
  </tbody>
</table>`,
  );
}
