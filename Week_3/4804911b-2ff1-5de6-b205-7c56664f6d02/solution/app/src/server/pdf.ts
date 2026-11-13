import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatDate, rupees } from "../shared/copy.js";
import { config } from "./config.js";
import { FRESH_CONNECTION } from "./status.js";

const FONT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public/fonts");
const BEBAS = "bebas-neue-latin-400-normal.woff2";
const GARAMOND = "eb-garamond-latin-400-normal.woff2";

interface PrintableVersion {
  number: string; version: number; title: string; effectiveDate: string; publishedDay: string; runOutUntil: string | null;
  reason: string | null; rows: { name: string; oldMrpPaise: number; revisedMrpPaise: number }[];
}

const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** The notice as print HTML. It references only the two font files that travel with the request. */
function noticeHtml(v: PrintableVersion): string {
  const lines = v.rows.map((r) => `${r.name} Rs ${rupees(r.oldMrpPaise)} to Rs ${rupees(r.revisedMrpPaise)}`);
  const longest = Math.max(20, ...lines.map((l) => Array.from(l).length));
  // keep every row on one line: the usable width is about 500pt and EB Garamond averages 0.42em per character
  const rowSize = Math.min(13, Math.floor((500 / (longest * 0.42)) * 10) / 10);
  const title = `Notice ${v.number}, version ${v.version}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
@font-face{font-family:"Bebas Neue";src:url("${BEBAS}") format("woff2")}
@font-face{font-family:"EB Garamond";src:url("${GARAMOND}") format("woff2")}
@page{size:A4;margin:0}
html,body{margin:0;padding:0}
body{padding:56pt 48pt;font-family:"EB Garamond",serif;color:#2a2a2a;font-size:12pt;line-height:1.35}
h1{font-family:"Bebas Neue",sans-serif;font-weight:400;font-size:46pt;line-height:1;margin:0 0 18pt;color:#9c1220;letter-spacing:1pt}
p{margin:0 0 6pt}
.rows{margin:16pt 0}
.row{white-space:nowrap;font-size:${rowSize}pt;margin:0 0 5pt}
.fine{margin-top:18pt;font-style:italic}
</style></head><body>
<h1>PRICE NOTICE</h1>
<p>Vasant Talkies Drinks</p>
<p>${escapeHtml(title)}</p>
<p>Effective ${formatDate(v.effectiveDate)}</p>
<p>Published ${formatDate(v.publishedDay)}</p>
<p>${escapeHtml(v.title)}</p>
${v.runOutUntil ? `<p>Old wrappers allowed until ${formatDate(v.runOutUntil)}</p>` : ""}${v.reason ? `<p>${escapeHtml(v.reason)}</p>` : ""}
<div class="rows">${lines.map((l) => `<p class="row">${escapeHtml(l)}</p>`).join("")}</div>
<p class="fine">The original MRP stays readable on every stickered pack.</p>
</body></html>`;
}

/** Renders the notice through Gotenberg; the caller bounds the time with `signal`. Throws on anything that is not a PDF. */
export async function renderPdf(v: PrintableVersion, signal: AbortSignal): Promise<Buffer> {
  const form = new FormData();
  form.append("files", new Blob([noticeHtml(v)], { type: "text/html" }), "index.html");
  for (const name of [BEBAS, GARAMOND]) form.append("files", new Blob([new Uint8Array(await readFile(path.join(FONT_DIR, name)))], { type: "font/woff2" }), name);
  for (const [k, val] of Object.entries({ paperWidth: "8.27", paperHeight: "11.7", marginTop: "0", marginBottom: "0", marginLeft: "0", marginRight: "0", printBackground: "true", preferCssPageSize: "false" }))
    form.append(k, val);
  const answer = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, { method: "POST", body: form, signal, headers: FRESH_CONNECTION });
  if (!answer.ok) throw new Error(`Gotenberg answered ${answer.status}`);
  const bytes = Buffer.from(await answer.arrayBuffer());
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("Gotenberg did not answer a PDF");
  return bytes;
}
