// Gotenberg renders the price sheet. The PDF is stored in Postgres only after
// Gotenberg returns a complete PDF, and sheetReady is true only then.
import { config } from "./config";
import { formatDMonY, formatIstTime } from "./clock";
import { hubById, modelById, finishById } from "./seed";
import { formatPaise } from "./money";
import type { LockRow } from "./db";
import { n } from "./db";

const GOTENBERG_TIMEOUT_MS = 15000;

// A 200 reply whose body does not start with %PDF-, or that has no %%EOF in its
// last 1024 bytes, is a failure.
export function isCompletePdf(body: Buffer): boolean {
  if (body.length < 5) return false;
  if (body.subarray(0, 5).toString("latin1") !== "%PDF-") return false;
  const tail = body.subarray(Math.max(0, body.length - 1024)).toString("latin1");
  return tail.includes("%%EOF");
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function sheetHtml(lock: LockRow, riderName: string): string {
  const model = modelById(lock.model);
  const finish = finishById(lock.finish);
  const hub = hubById(lock.hub);
  const onRoad = n(lock.on_road_paise);
  const exShowroom = n(lock.ex_showroom_paise);
  const roadTax = n(lock.road_tax_paise);
  const insurance = n(lock.insurance_paise);
  const closing =
    lock.state === "delivery_set" || lock.delivery_date !== null && lock.state !== "locked"
      ? `Delivery day ${formatDMonY(Date.parse(`${lock.delivery_date}T18:00:00+05:30`))}`
      : `Valid until ${formatDMonY(n(lock.expires_at_ms))}, ${formatIstTime(n(lock.expires_at_ms))}`;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
body { font-family: 'Helvetica', sans-serif; color: #1a1a1a; margin: 40px; }
h1 { font-size: 22px; margin: 0 0 2px; }
h2 { font-size: 16px; margin: 0 0 24px; color: #555; }
table { border-collapse: collapse; width: 100%; }
td, th { padding: 8px 12px; text-align: left; font-size: 14px; }
th { border-bottom: 1px solid #999; }
td.num { text-align: right; }
.total { font-size: 18px; font-weight: bold; }
.closing { margin-top: 24px; font-size: 15px; }
</style></head>
<body>
<h1>Malhar Motor Works</h1>
<h2>Price Sheet</h2>
<table>
<tr><th>Rider</th><td>${esc(riderName)}</td></tr>
<tr><th>Machine</th><td>${esc(model?.name ?? lock.model)}</td></tr>
<tr><th>Finish</th><td>${esc(finish?.name ?? lock.finish)}</td></tr>
<tr><th>Hub</th><td>${esc(hub?.name ?? lock.hub)}</td></tr>
<tr><th>Issue date</th><td>${esc(formatDMonY(n(lock.issued_at_ms)))}</td></tr>
<tr><th>Ex-showroom</th><td class="num">${esc(formatPaise(exShowroom))}</td></tr>
<tr><th>Road tax</th><td class="num">${esc(formatPaise(roadTax))}</td></tr>
<tr><th>Insurance</th><td class="num">${esc(formatPaise(insurance))}</td></tr>
<tr class="total"><th>On-road price</th><td class="num">${esc(formatPaise(onRoad))}</td></tr>
</table>
<p class="closing">${esc(closing)}</p>
</body></html>`;
}

// Renders through Gotenberg; returns complete PDF bytes, or null on any failure.
export async function renderPdf(html: string): Promise<Buffer | null> {
  try {
    const form = new FormData();
    form.append("index.html", new Blob([html], { type: "text/html" }), "index.html");
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), GOTENBERG_TIMEOUT_MS);
    const res = await fetch(`${config.gotenbergUrl.replace(/\/$/, "")}/forms/chromium/convert/html`, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const body = Buffer.from(await res.arrayBuffer());
    if (!isCompletePdf(body)) return null;
    return body;
  } catch {
    return null;
  }
}
