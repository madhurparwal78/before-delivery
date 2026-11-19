import { escapeHtml, attr, APP_CSS, APP_JS } from "./html.js";
import { PUBLIC_PAGES } from "../search.js";

export const NAV = [
  { path: "/", label: "Home" },
  { path: "/occasions/school", label: "School trips" },
  { path: "/occasions/weddings", label: "Weddings" },
  { path: "/occasions/company", label: "Company travel" },
  { path: "/occasions/festivals", label: "Festivals and sport" },
  { path: "/fleet", label: "Fleet" },
  { path: "/terms", label: "Terms" },
];

export interface PageMeta {
  title: string;
  h1: string;
  path: string;
}

export function shell(meta: PageMeta, body: string, opts: { lang?: string; dir?: string; public?: boolean } = {}): string {
  const lang = opts.lang ?? "en";
  const dir = opts.dir ?? "ltr";
  const current = NAV.find((n) => n.path === meta.path);
  const navLinks = NAV.map(
    (n) =>
      `<a href="${n.path}"${n.path === meta.path ? ' aria-current="page"' : ""}>${escapeHtml(n.label)}</a>`
  ).join("");
  const announce = `<div role="region" aria-label="Announcements" data-part="announcements" class="announcements" aria-live="polite"></div>`;
  const header = opts.public
    ? `
  <header class="masthead" data-part="masthead">
    <div class="masthead-inner">
      <a class="wordmark" href="/">Merrowfield<span>Coach Hire</span></a>
      <svg class="coach-mark" viewBox="0 0 220 90" aria-hidden="true" focusable="false"><rect x="4" y="16" width="200" height="56" fill="var(--plum)"/><rect x="4" y="16" width="200" height="10" fill="var(--cyan-bright)"/><circle cx="44" cy="74" r="12" fill="var(--ink)"/><circle cx="168" cy="74" r="12" fill="var(--ink)"/><rect x="18" y="30" width="26" height="16" fill="var(--cyan)"/><rect x="52" y="30" width="26" height="16" fill="var(--cyan)"/><rect x="86" y="30" width="26" height="16" fill="var(--cyan)"/><rect x="120" y="30" width="26" height="16" fill="var(--cyan)"/><rect x="154" y="30" width="30" height="16" fill="var(--cyan)"/></svg>
      <div class="call-block">
        <span class="call-label">Talk to the desk</span>
        <a class="call-link" href="tel:01632960140">Call 01632 960140</a>
        <a class="quote-link" href="/quote/route">Get a free quote</a>
      </div>
    </div>
    <nav class="underline-nav" aria-label="Main">${navLinks}</nav>
  </header>
  <div class="phone-top-bar" data-part="phone-top-bar">
    <a class="wordmark" href="/">Merrowfield<span>Coach Hire</span></a>
    <a class="phone-call" href="tel:01632960140">Call 01632 960140</a>
    <button type="button" class="menu-button" data-open="menu" aria-haspopup="dialog" aria-expanded="false">Menu</button>
  </div>
  <div class="slim-bar" data-part="slim-bar" hidden>
    <a class="wordmark" href="/">Merrowfield<span>Coach Hire</span></a>
    <nav aria-label="Main">${navLinks}</nav>
    <a class="quote-link" href="/quote/route">Get a free quote</a>
  </div>
  <div class="overlay-menu" data-overlay="menu" role="dialog" aria-modal="true" aria-label="Menu" hidden>
    <button type="button" class="close" data-close="menu">Close</button>
    <nav aria-label="Main">${navLinks}<a href="tel:01632960140">Call 01632 960140</a></nav>
  </div>`
    : "";
  const search = opts.public
    ? `
  <button type="button" class="search-button" data-open="search" aria-haspopup="dialog" aria-expanded="false">Search</button>
  <div class="overlay-search" data-overlay="search" role="dialog" aria-modal="true" aria-label="Search" hidden>
    <button type="button" class="close" data-close="search">Close</button>
    <form action="/search" method="get" data-search>
      <label class="field"><span class="label">Search the site</span><input type="search" name="q" class="search-input" autocomplete="off"></label>
      <button type="submit">Search</button>
    </form>
    <ul class="search-results" role="list" aria-label="Search results" data-results></ul>
  </div>`
    : "";
  const floating = opts.public
    ? `
  <a class="message-us" href="mailto:maria@merrowfield.example" aria-label="Message us" data-part="message-us"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 5h18v14H3z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 6l9 7 9-7" fill="none" stroke="currentColor" stroke-width="2"/></svg></a>
  <button type="button" class="back-to-top" data-back-to-top hidden>Back to top</button>`
    : "";
  const footer = opts.public
    ? `
  <footer class="footer">
    <p><a href="/terms">Terms</a> | <a href="/fleet">Fleet</a></p>
    <p>Merrowfield Coach Hire, Coventry</p>
  </footer>`
    : "";
  void current;
  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(meta.title)}</title>
<link rel="stylesheet" href="${APP_CSS}">
<script src="${APP_JS}" defer></script>
</head>
<body data-page="${attr(meta.path)}">
${announce}
${header}
${search}
<main id="main">
${body}
</main>
${footer}
${floating}
</body>
</html>`;
}

export function deskShell(meta: PageMeta, _deskName: string, body: string): string {
  const navLinks = [
    ["Enquiries", "/enquiries"],
    ["Operators", "/operators"],
    ["Payments", "/payments"],
    ["Diary", "/diary"],
    ["Documents", "/documents"],
    ["Rate tables", "/rates"],
    ["Customers", "/customers"],
    ["Complaints", "/aftercare/complaints"],
    ["Lost property", "/aftercare/lost-property"],
  ]
    .map(([label, path]) => `<a href="${path}"${meta.path === path ? ' aria-current="page"' : ""}>${escapeHtml(label)}</a>`)
    .join("");
  return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(meta.title)}</title>
<link rel="stylesheet" href="${APP_CSS}">
<script src="${APP_JS}" defer></script>
</head>
<body data-page="${attr(meta.path)}" data-desk-shell>
<div role="region" aria-label="Announcements" data-part="announcements" class="announcements" aria-live="polite"></div>
<header class="desk-band">
  <div class="desk-band-inner">
    <div class="desk-top">
      <a class="wordmark" href="/enquiries">Wayticket</a>
      <div class="desk-tools">
        <button type="button" class="menu-button" data-open="desk-menu" aria-haspopup="dialog" aria-expanded="false">Menu</button>
        <button type="button" data-action="change-password">Change password</button>
        <button type="button" data-action="sign-out">Sign out</button>
      </div>
    </div>
    <h1>${escapeHtml(meta.h1)}</h1>
    <nav class="desk-nav" aria-label="Desk">${navLinks}</nav>
  </div>
</header>
<div class="phone-desk-bar">
  <a class="wordmark" href="/enquiries">Wayticket</a>
  <button type="button" class="menu-button" data-open="desk-menu" aria-expanded="false">Menu</button>
</div>
<div class="overlay-menu desk-overlay" data-overlay="desk-menu" role="dialog" aria-modal="true" aria-label="Menu" hidden>
  <button type="button" class="close" data-close="desk-menu">Close</button>
  <nav aria-label="Desk">${navLinks}</nav>
  <button type="button" data-action="change-password">Change password</button>
  <button type="button" data-action="sign-out">Sign out</button>
</div>
<div class="refresh-line" data-part="refresh-line" hidden>Couldn't refresh. Trying again.</div>
<main id="main">
${body}
</main>
<div class="dialog-holder" data-dialogs></div>
<div class="bottom-bar" data-bottom-bar></div>
</body>
</html>`;
}

export function notFoundShell(title: string, h1: string, lang = "en", dir = "ltr", ended = false): string {
  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${APP_CSS}">
</head>
<body data-page="notfound" class="plain-page">
<main id="main" class="plain-main">
<h1>${escapeHtml(h1)}</h1>
${ended ? '<p class="ended-copy">This page has ended.</p>' : '<p class="notfound-copy">We can\'t find that.</p>'}
</main>
</body>
</html>`;
}

export function pageFor(path: string): { title: string; h1: string } | null {
  const p = PUBLIC_PAGES.find((x) => x.path === path);
  if (!p) return null;
  if (path === "/") {
    return { title: "Coach and minibus hire from Coventry | Merrowfield Coach Hire", h1: p.title };
  }
  return { title: `${p.title} | Merrowfield Coach Hire`, h1: p.title };
}
