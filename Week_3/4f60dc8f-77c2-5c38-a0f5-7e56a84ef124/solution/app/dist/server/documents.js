// Receipt and invoice PDFs: the studio's HTML template rendered by Gotenberg.
import { config } from "./config.js";
import { formatMoney } from "../shared/money.js";
function escape(text) {
    return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
export function documentHtml(doc) {
    const money = (minor) => escape(formatMoney(minor, doc.currency));
    const rows = (lines) => lines.map((line) => `<tr><td>${escape(line.description)}</td><td class="n">${money(line.amount_minor)}</td></tr>`).join("");
    const invoiceTable = doc.invoiceLines
        ? `<h2>This invoice</h2><table>${rows(doc.invoiceLines)}<tr class="strong"><td>${doc.headline.label}</td><td class="n">${money(doc.headline.amount_minor)}</td></tr></table>`
        : "";
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(doc.title)}</title><style>
body{font-family:Helvetica,Arial,sans-serif;color:#111;margin:48px;font-size:12pt;line-height:1.5}
h1{font-size:26pt;margin:0 0 4px;letter-spacing:-0.01em}h2{font-size:13pt;margin:28px 0 8px}
.meta{color:#444;margin:0 0 24px}table{width:100%;border-collapse:collapse}td{padding:8px 0;border-bottom:1px solid #ccc}
td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.strong td{font-weight:700;border-bottom:2px solid #111}
.headline{font-size:16pt;font-weight:700;margin:24px 0 0}.fx{margin-top:24px;color:#333}footer{margin-top:48px;color:#555;font-size:10pt}
</style></head><body>
<h1>${escape(doc.title)}</h1>
<p class="meta">${escape(doc.reference)} &middot; ${escape(doc.brandName)}</p>
<p class="headline">${doc.headline.label} ${money(doc.headline.amount_minor)}</p>
${invoiceTable}
<h2>Locked quote</h2>
<table>${rows(doc.lines)}
<tr><td>Subtotal</td><td class="n">${money(doc.subtotal_minor)}</td></tr>
<tr><td>VAT (20%)</td><td class="n">${money(doc.vat_minor)}</td></tr>
<tr class="strong"><td>Total</td><td class="n">${money(doc.total_minor)}</td></tr></table>
<p class="fx">${escape(doc.fxLine)}</p>
<footer>Gloamwork Studio</footer>
</body></html>`;
}
/** Renders HTML to a PDF; throws when Gotenberg cannot be reached or refuses. */
export async function renderPdf(html) {
    const form = new FormData();
    form.append("files", new Blob([html], { type: "text/html" }), "index.html");
    const response = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
    if (!response.ok)
        throw new Error(`gotenberg answered ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
}
export async function documentsReachable() {
    try {
        const response = await fetch(`${config.gotenbergUrl}/health`, { signal: AbortSignal.timeout(3_000) });
        await response.body?.cancel();
        return response.ok;
    }
    catch {
        return false;
    }
}
