import { modelsData } from "./public.js";
import { serviceState } from "./probes.js";
import type { Staff } from "./types.js";
export const esc = (v: unknown): string =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function formatTime(value: string, zone = "Europe/London"): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
  return parts.replace(" at", ",").replace(/,\s*,/, ",");
}
export const publication = (value: string): string =>
  `<time class="publication" datetime="${esc(value)}" data-publication="${esc(value)}">Published ${formatTime(value)} London</time>`;
export const date = (value: string): string =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  }).format(new Date(value));
export const status = (name: string, text = ""): string =>
  `<div role="status" aria-live="polite" aria-label="${esc(name)}" class="status">${esc(text)}</div>`;
export const icon = (name: "chevron" | "play" | "pause"): string =>
  `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${name === "chevron" ? '<path d="m6 9 6 6 6-6"/>' : name === "play" ? '<path d="m6 3 14 9-14 9V3Z"/>' : '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>'}</svg>`;
export const emptyDrawing = (): string =>
  '<svg class="empty-ledger" aria-hidden="true" width="80" height="40" viewBox="0 0 80 40"><path d="M0 1h80M0 20h80M0 39h80M18 1v38" fill="none" stroke="currentColor" stroke-width="1"/><path d="M29 20h25" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
export function input(
  label: string,
  name: string,
  value = "",
  options: {
    type?: string;
    required?: boolean;
    textarea?: boolean;
    hint?: string;
    error?: string;
  } = {},
): string {
  const key = `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return `<label class="field" for="${key}"><span>${esc(label)}</span>${options.textarea ? `<textarea aria-label="${esc(label)}" id="${key}" name="${esc(name)}" rows="${name === "body" ? 12 : 4}">${esc(value)}</textarea>` : `<input aria-label="${esc(label)}" id="${key}" name="${esc(name)}" type="${options.type || "text"}" value="${esc(value)}"${options.required ? " required" : ""}>`}${options.hint ? `<small>${esc(options.hint)}</small>` : ""}<span class="field-error" id="error-${key}" data-error="${esc(name)}">${esc(options.error || "")}</span></label>`;
}
export function select(
  label: string,
  name: string,
  options: [string, string][],
  value = "",
  emptyLabel?: string,
): string {
  return `<label class="field" for="field-${name}"><span>${esc(label)}</span><select id="field-${name}" name="${esc(name)}">${emptyLabel !== undefined ? `<option value="">${esc(emptyLabel)}</option>` : ""}${options.map(([v, t]) => `<option value="${esc(v)}"${value === v ? " selected" : ""}>${esc(t)}</option>`).join("")}</select><span class="field-error" data-error="${esc(name)}"></span></label>`;
}
export function dialog(
  id: string,
  title: string,
  body: string,
  safe = "Cancel",
  safeAction?: string,
): string {
  return `<dialog id="${id}" aria-labelledby="${id}-title"><h2 id="${id}-title">${esc(title)}</h2>${body}${safeAction ? `<form method="get" action="${esc(safeAction)}"><button type="submit" data-close-dialog autofocus>${esc(safe)}</button></form>` : `<button type="button" data-close-dialog${safe === "Keep my application" ? " autofocus" : ""}>${esc(safe)}</button>`}</dialog>`;
}
export function sectionNav(items: { id: string; heading: string }[]): string {
  const links = items
    .map(
      (s, i) =>
        `<a href="#${esc(s.id)}"${i ? "" : ' aria-current="location"'}>${esc(s.heading)}</a>`,
    )
    .join("");
  return `<aside class="section-rail"><details open><summary>Sections</summary><nav aria-label="Sections">${links}</nav></details></aside>`;
}
const serviceNotice = (state: { storage: boolean; mail: boolean }): string =>
  [
    state.mail
      ? ""
      : "Mail delivery is delayed. Messages are queued and will be sent when mail returns.",
    state.storage
      ? ""
      : "File storage is unreachable. Applications, résumé downloads and samples are paused.",
  ]
    .filter(Boolean)
    .join(" ");
export const asOfBanner = (asOf: string | null, path: string): string =>
  asOf
    ? `<section class="as-of" aria-label="Record as of"><p>You are reading the record as it stood at ${formatTime(asOf)} London.</p><a href="${esc(path)}">Read the current record</a></section>`
    : "";
export async function layout(
  title: string,
  main: string,
  options: { staff?: Staff; console?: boolean; active?: string } = {},
): Promise<string> {
  const models = (await modelsData()).items;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} · Aldermoor Labs</title><link rel="stylesheet" href="/style.css"><link rel="preload" href="/fonts/newsreader-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin><script src="/browser.js" type="module"></script></head><body${options.console ? ' class="console-page"' : ""}><a class="skip" href="#content">Skip to content</a><header class="site-header sheet"><div class="wordmark">Aldermoor<span>Labs / Open Record</span></div><button class="mobile-menu" type="button" aria-expanded="false" data-menu>Menu</button><nav class="primary" aria-label="Primary"><a href="/"${options.active === "thesis" ? ' aria-current="page"' : ""}>Thesis</a><div class="models-disclosure"><button type="button" data-models aria-expanded="false">Models ${icon("chevron")}</button><div class="models-menu" hidden></div><template data-models-list>${models.map((m) => `<a href="/models/${esc(m.slug)}">${esc(m.title)}</a>`).join("")}<a href="/models">All model routes</a></template><noscript><div>${models.map((m) => `<a href="/models/${esc(m.slug)}">${esc(m.title)}</a>`).join("")}</div></noscript></div><a href="/news"${options.active === "news" ? ' aria-current="page"' : ""}>Newsroom</a><a href="/search"${options.active === "search" ? ' aria-current="page"' : ""}>Search</a><a href="/careers"${options.active === "careers" ? ' aria-current="page"' : ""}>Careers</a></nav></header>${options.console ? `<div class="console-bar sheet"><nav aria-label="Console"><a href="/console">Work queue</a>${options.staff?.roles.some((r) => ["editor", "approver"].includes(r.role)) ? '<a href="/console/rows">Benchmark rows</a>' : ""}${options.staff?.roles.some((r) => r.role === "recruiter") ? '<a href="/console/requisitions">Requisitions</a><a href="/console/benefits">Benefits</a>' : ""}${options.staff?.roles.some((r) => r.role === "administrator") ? '<a href="/console/grants">Grants</a><a href="/console/audit">Audit record</a><a href="/console/jobs">Jobs</a>' : ""}</nav><div class="identity">${esc(options.staff?.name)}<button type="button" data-signout>Sign out</button></div></div><div class="sheet service-status">${status("Service status", serviceNotice(serviceState()))}</div>` : ""}<main id="content" class="sheet" tabindex="-1">${main}</main><footer class="site-footer sheet"><span>Aldermoor Labs <span class="footer-note">A Corvane Group research lab</span></span><div><a href="/feed.xml">Feed</a><a href="/console/sign-in">Staff sign-in</a></div></footer></body></html>`;
}
