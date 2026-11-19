import { config } from '../config.js';
import { AppError } from '../errors.js';
import { vatOf, vatRate } from '../domain.js';
import type { MailMessage } from './lib/mail.js';

export interface InvoiceLines {
  invoice_number: string;
  issue_date: string;
  seller_name: string;
  seller_address: string;
  buyer_name: string;
  buyer_email: string;
  buyer_country: string;
  piece_title: string;
  edition: number;
  edition_count: number;
  net_cents: number;
  vat_rate: number;
  vat_cents: number;
  gross_cents: number;
}

const money = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

const esc = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function invoiceHtml(lines: InvoiceLines): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${esc(lines.invoice_number)}</title>
<style>
body{font-family:Helvetica,Arial,sans-serif;color:#111;margin:0;padding:28px;}
h1{font-size:22px;margin:0 0 4px;}
.meta{color:#555;font-size:12px;margin-bottom:22px;}
table{width:100%;border-collapse:collapse;font-size:14px;}
td,th{padding:8px 6px;border-bottom:1px solid #ddd;text-align:left;}
tr.total td{font-weight:bold;border-top:2px solid #111;}
.right{text-align:right;}
</style></head><body>
<h1>Invoice ${esc(lines.invoice_number)}</h1>
<div class="meta">Issue date: ${esc(lines.issue_date)}</div>
<p><strong>${esc(lines.seller_name)}</strong><br>${esc(lines.seller_address)}</p>
<p>Sold through Phosphene Yard by Brightmoss Works</p>
<p>Bill to: ${esc(lines.buyer_name)}<br>${esc(lines.buyer_email)}<br>${esc(lines.buyer_country)}</p>
<table>
<tr><th>Description</th><th class="right">Amount</th></tr>
<tr><td>${esc(lines.piece_title)} — edition ${lines.edition} of ${lines.edition_count}</td><td class="right">${money(lines.net_cents)}</td></tr>
<tr><td>VAT ${lines.vat_rate}%</td><td class="right">${money(lines.vat_cents)}</td></tr>
<tr class="total"><td>Total</td><td class="right">${money(lines.gross_cents)}</td></tr>
</table>
</body></html>`;
}

export function creditNoteHtml(input: {
  credit_note_number: string;
  invoice_number: string;
  net_cents: number;
  vat_rate: number;
  vat_cents: number;
  gross_cents: number;
}): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Credit note ${esc(input.credit_note_number)}</title>
<style>body{font-family:Helvetica,Arial,sans-serif;color:#111;margin:0;padding:28px;}h1{font-size:22px;}table{width:100%;border-collapse:collapse;font-size:14px;}td,th{padding:8px 6px;border-bottom:1px solid #ddd;text-align:left;}.right{text-align:right;}tr.total td{font-weight:bold;border-top:2px solid #111;}</style></head><body>
<h1>Credit note ${esc(input.credit_note_number)}</h1>
<p>Refers to invoice ${esc(input.invoice_number)}</p>
<table>
<tr><th>Description</th><th class="right">Amount</th></tr>
<tr><td>Credited net</td><td class="right">${money(input.net_cents)}</td></tr>
<tr><td>VAT ${input.vat_rate}%</td><td class="right">${money(input.vat_cents)}</td></tr>
<tr class="total"><td>Total credited</td><td class="right">${money(input.gross_cents)}</td></tr>
</table>
</body></html>`;
}

export interface StatementLines {
  period_label: string;
  creator_name: string;
  lines: { date: string; piece_title: string; edition: number; kind: string; amount_cents: number }[];
  total_cents: number;
}

export function statementHtml(input: StatementLines): string {
  const rows = input.lines.map((line) => `<tr><td>${esc(line.date)}</td><td>${esc(line.piece_title)}</td><td>Edition ${line.edition}</td><td>${esc(line.kind)}</td><td class="right">${money(line.amount_cents)}</td></tr>`).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Statement ${esc(input.period_label)}</title>
<style>body{font-family:Helvetica,Arial,sans-serif;color:#111;margin:0;padding:28px;}h1{font-size:22px;}table{width:100%;border-collapse:collapse;font-size:14px;}td,th{padding:8px 6px;border-bottom:1px solid #ddd;text-align:left;}.right{text-align:right;}tr.total td{font-weight:bold;border-top:2px solid #111;}</style></head><body>
<h1>Statement ${esc(input.period_label)}</h1>
<p>${esc(input.creator_name)}</p>
<table>
<tr><th>Date</th><th>Piece</th><th>Edition</th><th>Kind</th><th class="right">Amount</th></tr>
${rows}
<tr class="total"><td colspan="4">Total</td><td class="right">${money(input.total_cents)}</td></tr>
</table>
</body></html>`;
}

export function receiptEmail(pieceTitle: string, edition: number, editionCount: number, invoiceNumber: string, pdfBase64: string): MailMessage {
  return {
    to: '',
    subject: `Your receipt for ${pieceTitle} — edition ${edition} of ${editionCount}`,
    text: `Thank you for collecting edition ${edition} of ${editionCount} of ${pieceTitle}.\nYour invoice ${invoiceNumber} is attached.\n— Phosphene Yard`,
    attachments: [{ filename: `${invoiceNumber}.pdf`, contentType: 'application/pdf', base64: pdfBase64 }]
  };
}

export function renderReadyEmail(pieceTitle: string): MailMessage {
  return {
    to: '',
    subject: `Export ready: ${pieceTitle}`,
    text: `Your export of ${pieceTitle} finished rendering and is ready to download from your studio.\n— Phosphene Yard`,
    attachments: []
  };
}

export function refundNoticeEmail(creditNoteNumber: string, pdfBase64: string, invoiceNumber: string): MailMessage {
  return {
    to: '',
    subject: `Refund issued: ${creditNoteNumber}`,
    text: `A refund was issued on your order, recorded as credit note ${creditNoteNumber} against invoice ${invoiceNumber}.\n— Phosphene Yard`,
    attachments: [{ filename: `${creditNoteNumber}.pdf`, contentType: 'application/pdf', base64: pdfBase64 }]
  };
}

export function statementEmail(periodLabel: string, pdfBase64: string): MailMessage {
  return {
    to: '',
    subject: `Your ${periodLabel} statement from Phosphene Yard`,
    text: `Your ${periodLabel} payout statement is attached.\n— Phosphene Yard`,
    attachments: [{ filename: `statement-${periodLabel}.pdf`, contentType: 'application/pdf', base64: pdfBase64 }]
  };
}

export function vatLines(netCents: number, country: string): { vat_rate_percent: number; vat_cents: number; gross_cents: number } {
  const rate = vatRate(country);
  const vat = vatOf(netCents, rate);
  return { vat_rate_percent: rate, vat_cents: vat, gross_cents: netCents + vat };
}

export function assertPaymentsUp(reachable: boolean): void {
  if (!reachable) throw AppError.paymentsUnavailable();
}

export const PAY_FROM = config.mailFrom;
