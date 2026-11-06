import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Coverage } from "./documents.js";
import type { Reply } from "./http.js";
import type { Binder } from "./routes/binder.js";
import { localStamp } from "./time.js";

const CLIENT = fileURLToPath(new URL("../client/", import.meta.url));
const SPA_ROUTES = new Set(["/", "/board", "/tickets", "/pack", "/documents", "/counter", "/manage"]);
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2", ".svg": "image/svg+xml",
};

const manifest = JSON.parse(readFileSync(`${CLIENT}.vite/manifest.json`, "utf8")) as Record<string, { css?: string[] }>;
const stylesheets = (manifest["index.html"]?.css ?? []).map((href) => `<link rel="stylesheet" href="/${href}">`).join("");
const indexHtml = readFileSync(`${CLIENT}index.html`);

/** The built client: the SPA shell on its routes, hashed files under /assets, and the favicon. Nothing else. */
export function staticReply(method: string, path: string): Reply | null {
  if (method !== "GET" && method !== "HEAD") return null;
  if (SPA_ROUTES.has(path)) return { status: 200, raw: { data: indexHtml, type: "text/html; charset=utf-8", headers: { "Cache-Control": "no-cache" } } };
  const asset = /^\/assets\/([A-Za-z0-9_.-]+)$/.exec(path)?.[1];
  const file = asset ? `${CLIENT}assets/${asset}` : path === "/favicon.svg" ? `${CLIENT}favicon.svg` : null;
  const type = file ? TYPES[file.slice(file.lastIndexOf("."))] : undefined;
  if (!file || !type || !existsSync(file)) return null;
  return { status: 200, raw: { data: readFileSync(file), type, headers: { "Cache-Control": asset ? "public, max-age=31536000, immutable" : "no-cache" } } };
}

const escape = (text: string): string => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

function shell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<title>${escape(title)}</title><link rel="icon" href="/favicon.svg" type="image/svg+xml">${stylesheets}</head>`
    + `<body class="binder-body">${body}</body></html>`;
}

const DOWNLOAD_ICON = `<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/></svg>`;

function cell(coverage: Coverage, text: (coverage: Coverage) => string): string {
  return `<td><span class="doc-state doc-${coverage.status}">${escape(text(coverage))}</span></td>`;
}

/** The inspector's read-only binder page (brief: Binder screen). */
export function binderPage(binder: Binder, pdfHref: string, text: (coverage: Coverage) => string): string {
  const rows = binder.rows.map((row) => `<tr><td class="mono">${row.date}</td><td>${escape(row.renter_name)}</td><td>${escape(row.business)}</td>`
    + `<td>${escape(row.station)} <span class="mono">${row.local_start.slice(11)}–${row.local_end.slice(11)}</span></td>`
    + `${cell(row.liability, text)}${cell(row.food_handler, text)}</tr>`).join("");
  const empty = `<tr><td colspan="6" class="empty-row">No bookings are on the schedule in this range.</td></tr>`;
  return shell(`Compliance binder — ${binder.site.name}`, `<main class="binder">
<header class="binder-head">
  <p class="eyebrow">Hearthshift · Compliance binder · read-only</p>
  <h1>${escape(binder.site.name)}</h1>
  <p class="binder-meta"><span class="mono">${binder.from}</span> to <span class="mono">${binder.to}</span> · Generated <span class="mono">${escape(localStamp(binder.site.time_zone, binder.generatedAt))}</span></p>
  <a class="button button-primary" href="${pdfHref}" download>${DOWNLOAD_ICON}<span>Download PDF</span></a>
</header>
<div class="table-frame" role="region" aria-label="Binder schedule" tabindex="0">
<table aria-label="Compliance binder"><thead><tr><th scope="col">Date</th><th scope="col">Renter</th><th scope="col">Business</th><th scope="col">Station and time</th><th scope="col">Liability certificate</th><th scope="col">Food handler card</th></tr></thead>
<tbody>${rows || empty}</tbody></table>
</div>
</main>`);
}

export function deadLinkPage(): string {
  return shell("Binder link no longer valid", `<main class="binder binder-dead"><h1>This binder link is no longer valid</h1></main>`);
}
