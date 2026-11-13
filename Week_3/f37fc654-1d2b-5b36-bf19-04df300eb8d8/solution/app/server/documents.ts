// HTML for the contract and invoice PDFs, rendered by Gotenberg (brief: Services › Gotenberg).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { STUDIO_NAME } from "../shared/catalog.js";
import { usd } from "../shared/format.js";

const escape = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function fontFace(family: string, file: string): string {
  try {
    const data = readFileSync(fileURLToPath(new URL(`../client/fonts/${file}`, import.meta.url))).toString("base64");
    return `@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${data}) format("woff2");font-weight:400}`;
  } catch {
    return "";
  }
}

const FONTS = fontFace("Inter Tight", "inter-tight-latin-400.woff2") + fontFace("Inter", "inter-latin-400.woff2");

const page = (title: string, body: string): string => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(title)}</title>
<style>${FONTS}
@page{size:A4;margin:22mm 20mm}
body{font-family:"Inter",Arial,sans-serif;color:#0b1020;font-size:11pt;line-height:1.5;font-variant-numeric:tabular-nums}
h1{font-family:"Inter Tight","Inter",Arial,sans-serif;font-weight:400;font-size:22pt;line-height:1.15;margin:0 0 6mm;letter-spacing:-0.01em}
h2{font-family:"Inter Tight","Inter",Arial,sans-serif;font-weight:400;font-size:13pt;margin:8mm 0 3mm;border-bottom:1px solid #c9cfdb;padding-bottom:1.5mm}
.mark{font-size:9pt;letter-spacing:0.14em;text-transform:uppercase;color:#2271e3;margin-bottom:8mm}
table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:1.6mm 0;border-bottom:1px solid #e3e7ef;vertical-align:top}
td.n,th.n{text-align:right}.total td{font-weight:400;border-top:1.5px solid #0b1020;border-bottom:none}
dl{display:grid;grid-template-columns:42mm 1fr;gap:1.5mm 4mm;margin:0}dt{color:#4a5263}dd{margin:0}
.sig{margin-top:10mm;padding-top:4mm;border-top:1px solid #0b1020;font-family:"Inter Tight","Inter",Arial,sans-serif;font-size:16pt}
</style></head><body><div class="mark">${STUDIO_NAME}</div>${body}</body></html>`;

interface Row {
  label: string;
  amount: string;
}

const rows = (items: Row[]): string => items.map((r) => `<tr><td>${escape(r.label)}</td><td class="n">${escape(r.amount)}</td></tr>`).join("");

export interface ContractSnapshot {
  title: string; clientName: string; clientEmail: string; installation: string; venue: string; heldDate: string;
  lines: Row[]; total: string; schedule: Row[]; funders: { name: string; share: string; amount: string }[];
  signatureName: string; signedAtText: string;
}

export function contractHtml(s: ContractSnapshot): string {
  const heading = `Commission agreement — ${s.title}`;
  return page(heading, `<h1>${escape(heading)}</h1>
<dl><dt>Studio</dt><dd>${STUDIO_NAME}</dd><dt>Client</dt><dd>${escape(s.clientName)} (${escape(s.clientEmail)})</dd>
<dt>Installation</dt><dd>${escape(s.installation)}</dd><dt>Venue</dt><dd>${escape(s.venue)}</dd><dt>Install day</dt><dd>${escape(s.heldDate)}</dd></dl>
<h2>Quote</h2><table>${rows(s.lines)}<tr class="total"><td>Total</td><td class="n">${escape(s.total)}</td></tr></table>
<h2>Payment schedule</h2><table>${rows(s.schedule)}</table>
<h2>Funders</h2><table>${s.funders.map((f) => `<tr><td>${escape(f.name)}</td><td>${escape(f.share)}</td><td class="n">${escape(f.amount)}</td></tr>`).join("")}</table>
<h2>Signature</h2><p>Signed by the client, typed as their full name, on ${escape(s.signedAtText)}.</p><div class="sig">${escape(s.signatureName)}</div>`);
}

export interface InvoiceSnapshot {
  title: string; label: string; payerName: string; payerEmail: string; invoiceNumber: string; venueName: string;
  subtotalCents: number; taxCents: number; amountCents: number; dueBy: string;
}

export function invoiceHtml(s: InvoiceSnapshot): string {
  const heading = `Invoice — ${s.title} — ${s.label}`;
  return page(heading, `<h1>${escape(heading)}</h1>
<dl><dt>Payer</dt><dd>${escape(s.payerName)} (${escape(s.payerEmail)})</dd><dt>Kill Bill invoice</dt><dd>${escape(s.invoiceNumber)}</dd>
<dt>Venue</dt><dd>${escape(s.venueName)}</dd></dl>
<h2>Amounts</h2><table>${rows([{ label: "Work", amount: usd(s.subtotalCents) }, { label: "Sales tax", amount: usd(s.taxCents) }])}
<tr class="total"><td>Total</td><td class="n">${usd(s.amountCents)}</td></tr></table>
<h2>Due by</h2><p>${escape(s.dueBy)}</p>`);
}
