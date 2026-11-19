import { BILLING_COUNTRIES, dollars, monthName } from "../shared/rules.js";

// The HTML Gotenberg turns into invoice, credit note and statement PDFs. Each required phrase sits in
// one element so the PDF's text reads it whole.

const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

const countryName = (code: string): string => BILLING_COUNTRIES.find((c) => c.code === code)?.label ?? code;
const money = (cents: number): string => `$${dollars(cents)}`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
  @page { size: A4; margin: 22mm 20mm; }
  body { font-family: "DejaVu Sans", "Liberation Sans", Arial, sans-serif; color: #141414; font-size: 11pt; line-height: 1.5; }
  .brand { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 3px solid #141414; padding-bottom: 8pt; margin-bottom: 18pt; }
  .brand strong { font-size: 13pt; letter-spacing: 0.02em; }
  .mark { display: inline-block; width: 10pt; height: 10pt; background: #d4bb12; margin-right: 6pt; vertical-align: -1pt; }
  h1 { font-size: 22pt; margin: 0 0 4pt; letter-spacing: -0.01em; }
  .muted { color: #555; }
  .cols { margin: 18pt 0; }
  .cols > div { margin-bottom: 12pt; }
  .label { font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.08em; color: #555; margin-bottom: 3pt; }
  table { width: 100%; border-collapse: collapse; margin-top: 12pt; }
  th, td { text-align: left; padding: 7pt 0; border-bottom: 1px solid #ddd; vertical-align: top; }
  th { font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.08em; color: #555; font-weight: normal; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr.total td { border-bottom: none; border-top: 2px solid #141414; font-weight: bold; }
  footer { margin-top: 28pt; font-size: 9pt; color: #555; }
  </style></head><body>
  <div class="brand"><strong><span class="mark"></span>Phosphene Yard</strong><span class="muted">Brightmoss Works</span></div>
  ${body}
  </body></html>`;
}

interface InvoiceDoc {
  number: string;
  issued: string;
  sellerName: string;
  sellerAddress: string | null;
  buyerName: string;
  buyerEmail: string;
  buyerCountry: string;
  line: string;
  net: number;
  rate: number;
  vat: number;
  gross: number;
}

export function invoiceHtml(d: InvoiceDoc): string {
  return page(`Invoice ${d.number}`, `
  <h1>Invoice ${esc(d.number)}</h1>
  <div class="muted">Issued ${esc(d.issued)}</div>
  <div class="cols">
    <div><div class="label">Seller</div><div>${esc(d.sellerName)}</div>${d.sellerAddress ? `<div>${esc(d.sellerAddress)}</div>` : ""}
      <div class="muted">Sold through Phosphene Yard by Brightmoss Works</div></div>
    <div><div class="label">Billed to</div><div>${esc(d.buyerName)}</div><div>${esc(d.buyerEmail)}</div>
      <div>${esc(countryName(d.buyerCountry))} (${esc(d.buyerCountry)})</div></div>
  </div>
  <table>
    <tr><th>Item</th><th class="num">Amount</th></tr>
    <tr><td>${esc(d.line)}</td><td class="num">${money(d.net)}</td></tr>
    <tr><td>Net</td><td class="num">${money(d.net)}</td></tr>
    <tr><td>VAT ${d.rate}%</td><td class="num">${money(d.vat)}</td></tr>
    <tr class="total"><td>Gross (USD)</td><td class="num">${money(d.gross)}</td></tr>
  </table>
  <footer>Prices are tax-exclusive. VAT is charged at the rate for the billing country. This invoice is numbered in a gapless yearly sequence.</footer>`);
}

interface CreditNoteDoc {
  number: string;
  invoiceNumber: string;
  issued: string;
  buyerName: string;
  line: string;
  net: number;
  rate: number;
  vat: number;
  gross: number;
}

export function creditNoteHtml(d: CreditNoteDoc): string {
  return page(`Credit note ${d.number}`, `
  <h1>Credit note ${esc(d.number)}</h1>
  <div class="muted">Issued ${esc(d.issued)}</div>
  <div class="cols">
    <div><div class="label">Reference</div><div>Refers to invoice ${esc(d.invoiceNumber)}</div><div>${esc(d.line)}</div></div>
    <div><div class="label">Credited to</div><div>${esc(d.buyerName)}</div></div>
  </div>
  <table>
    <tr><th>Credited</th><th class="num">Amount</th></tr>
    <tr><td>Net credited</td><td class="num">${money(d.net)}</td></tr>
    <tr><td>VAT ${d.rate}% credited</td><td class="num">${money(d.vat)}</td></tr>
    <tr class="total"><td>Gross credited (USD)</td><td class="num">${money(d.gross)}</td></tr>
  </table>
  <footer>Sold through Phosphene Yard by Brightmoss Works. Refunded to the original payment.</footer>`);
}

export interface StatementLine {
  date: string;
  piece_title: string;
  edition: number;
  kind: "sale" | "remix_sale" | "royalty" | "refund";
  amount_cents: number;
}

const KIND_LABEL: Record<StatementLine["kind"], string> = { sale: "Sale", remix_sale: "Remix sale", royalty: "Royalty", refund: "Refund" };
const signed = (cents: number): string => (cents < 0 ? `− $${dollars(-cents)}` : `+ $${dollars(cents)}`);

export function statementHtml(period: string, creatorName: string, lines: StatementLine[], total: number): string {
  return page(`Statement ${monthName(period)}`, `
  <h1>Statement ${esc(monthName(period))}</h1>
  <div>${esc(creatorName)}</div>
  <div class="muted">What Phosphene Yard owes you for sales, remix sales and royalties in ${esc(monthName(period))}.</div>
  <table>
    <tr><th>Date</th><th>Piece</th><th>Edition</th><th>Kind</th><th class="num">Amount</th></tr>
    ${lines
      .map((l) => `<tr><td>${esc(l.date)}</td><td>${esc(l.piece_title)}</td><td>${l.edition}</td><td>${KIND_LABEL[l.kind]}</td><td class="num">${signed(l.amount_cents)}</td></tr>`)
      .join("")}
    <tr class="total"><td colspan="4">Total owed</td><td class="num">${signed(total)}</td></tr>
  </table>
  <footer>Sold through Phosphene Yard by Brightmoss Works. A statement records what is owed; it is not a payout.</footer>`);
}
