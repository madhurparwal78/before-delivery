import { NAV_SECTIONS, SOCIAL_LINKS } from "../../shared/catalog.js";
import { type PageKind } from "../../shared/page-kind.js";
import { html, type Markup } from "./html.js";
import { ICONS } from "./icons.js";

/** The chrome every page shares: skip link, header, menu dialog, footer, live regions and the custom cursor. */

export interface PageFrame {
  readonly kind: PageKind;
  readonly title: string;
  readonly main: Markup;
  readonly dialogs?: Markup;
}

const PRELOADED_FONTS = ["fraunces-latin-full-normal", "ibm-plex-sans-latin-400-normal", "ibm-plex-sans-latin-500-normal", "ibm-plex-sans-latin-600-normal", "ibm-plex-mono-latin-400-normal", "ibm-plex-mono-latin-500-normal"];
const STYLE_SHEETS = ["tokens", "base", "layout", "components", "pages", "motion"];
const CLIENT_ENTRY = "/assets/js/app.js";

export function glyph(character: "→" | "↗"): Markup {
  return html`<span class="glyph" aria-hidden="true">${character}</span>`;
}

export function externalLink(name: string, href: string): Markup {
  return html`<a class="external-link" href="${href}" target="_blank" rel="noopener noreferrer" aria-label="Ottoline Rask on ${name} (opens in a new tab)">${name} ${glyph("↗")}</a>`;
}

function sectionHref(id: string): string {
  return `/#${id}`;
}

function header(): Markup {
  return html`<header class="site-header" data-site-header>
    <div class="header-inner">
      <a class="brand" href="/" aria-label="Ottoline Rask home" data-home-link><span class="brand-name">Ottoline Rask</span></a>
      <nav class="primary-nav" aria-label="Sections">
        <ul>${NAV_SECTIONS.map((section) => html`<li><a href="${sectionHref(section.id)}" data-section-link="${section.id}">${section.label}</a></li>`)}</ul>
      </nav>
      <button type="button" class="menu-button" aria-expanded="false" aria-controls="menu-dialog" aria-haspopup="dialog" data-menu-open>${ICONS.menu}<span>Menu</span></button>
    </div>
  </header>`;
}

function menuDialog(): Markup {
  return html`<div class="modal-layer menu-layer" data-modal-layer="menu" hidden>
    <div class="menu-panel" id="menu-dialog" role="dialog" aria-modal="true" aria-label="Menu" data-dialog="menu">
      <div class="menu-bar">
        <span class="menu-bar-title" aria-hidden="true">Menu</span>
        <button type="button" class="icon-button" data-modal-close aria-label="Close menu">${ICONS.close}</button>
      </div>
      <nav aria-label="Menu sections">
        <ul>${NAV_SECTIONS.map((section) => html`<li><a href="${sectionHref(section.id)}" data-section-link="${section.id}">${section.label}</a></li>`)}</ul>
      </nav>
    </div>
  </div>`;
}

function footer(): Markup {
  const letters = [..."Ottoline Rask"].filter((character) => character !== " ");
  const wordmark = html`<span class="wordmark-word">${letters.slice(0, 8).map((letter) => html`<span class="wordmark-letter" aria-hidden="true">${letter}</span>`)}</span> <span class="wordmark-word">${letters.slice(8).map((letter) => html`<span class="wordmark-letter" aria-hidden="true">${letter}</span>`)}</span>`;
  return html`<footer class="site-footer" data-footer>
    <div class="sheet footer-inner">
      <p class="footer-wordmark" data-footer-mark role="img" aria-label="Ottoline Rask">${wordmark}</p>
      <nav class="footer-nav" aria-label="Footer">
        <ul>${NAV_SECTIONS.map((section) => html`<li><a href="${sectionHref(section.id)}" data-section-link="${section.id}">${section.label}</a></li>`)}</ul>
      </nav>
      <ul class="footer-social">${SOCIAL_LINKS.map((link) => html`<li>${externalLink(link.name, link.href)}</li>`)}</ul>
      <button type="button" class="button button-ghost footer-top" data-back-to-top>Back to top</button>
      <p class="footer-copy">© 2026 Quillfern Works.</p>
      <p class="footer-notice">Ottoline Rask and Quillfern Works are fictional. Projects, clients, reviews, figures and the career timeline on this site are illustrative.</p>
    </div>
  </footer>`;
}

export function renderDocument(frame: PageFrame): string {
  const fonts = PRELOADED_FONTS.map((name) => html`<link rel="preload" href="/assets/fonts/${name}.woff2" as="font" type="font/woff2" crossorigin>`);
  const sheets = STYLE_SHEETS.map((name) => html`<link rel="stylesheet" href="/assets/css/${name}.css">`);
  return `<!doctype html>\n${html`<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${frame.title}</title>
<meta name="description" content="Ottoline Rask Selected Builds: the illustrative hiring portfolio of an invented developer and digital creator trading as Quillfern Works.">
<meta name="color-scheme" content="light">
${fonts}
${sheets}
<script>addEventListener("click",function(e){var b=e.target instanceof Element?e.target.closest("[data-callout-button]"):null;if(b&&!window.__calloutsReady)(window.__earlyCallouts=window.__earlyCallouts||[]).push(b);},true);</script>
<script defer src="${CLIENT_ENTRY}"></script>
</head>
<body data-page="${frame.kind}">
<a class="skip-link" href="#page-title" data-skip-link>Skip to content</a>
<div id="site-root" data-site-root>
${header()}
<main id="main" data-main>
<div class="media-notice" role="status" aria-label="Media notice" data-media-notice hidden></div>
${frame.main}
</main>
${footer()}
</div>
${menuDialog()}
${frame.dialogs}
<div class="sr-only" role="status" aria-label="Site updates" aria-live="polite" data-site-updates></div>
<div class="cursor" data-cursor data-visible="false" data-cursor-state="default" aria-hidden="true"><span class="cursor-disc"><span class="cursor-label" data-cursor-label></span></span></div>
</body>
</html>`.text}`;
}
