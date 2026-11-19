/** Marketing chrome: the fixed frosted header, the narrow-window menu and the footer around every public page. */
import { documentShell, esc, type RenderedPage } from "../layout.js";
import { icon, markSvg } from "./icons.js";
import {
  FOOTER_GROUPS,
  HEADER_MENUS,
  OPEN_ACCOUNT_LINK,
  PARTNER_DISCLAIMER,
  PRICING_LINK,
  SESSION_LINKS,
  type HeaderMenu,
  type NavLink,
} from "./navigation.js";

interface MarketingDocumentOptions {
  title: string;
  description?: string;
  page: string;
  bodyClass?: string;
  /** Inner content of the page; it is wrapped in <main id="main">. */
  main: string;
  scripts?: string[];
  styles?: string[];
}

function link(item: NavLink, className: string): string {
  return `<a class="${className}" href="${esc(item.href)}">${esc(item.label)}</a>`;
}

function brand(): string {
  return `<a class="brand" href="/">${markSvg()}<span class="brand-word">Tallwind</span></a>`;
}

function menuItem(menu: HeaderMenu): string {
  const panelId = `menu-${menu.id}`;
  const links = menu.links.map((item) => `<li>${link(item, "menu-link")}</li>`).join("");
  return `<li class="header-item" data-header-menu>
          <button class="menu-trigger" type="button" aria-expanded="false" aria-controls="${panelId}" data-menu-trigger>${esc(menu.label)}${icon("chevronDown", "icon icon-chevron")}</button>
          <ul class="menu-panel" id="${panelId}" hidden>${links}</ul>
        </li>`;
}

function header(): string {
  const items = HEADER_MENUS.map(menuItem).join("");
  const sessionLinks = SESSION_LINKS.map((item) => link(item, "header-link")).join("");
  return `<header class="site-header">
    <div class="header-bar">
      ${brand()}
      <nav class="header-nav" aria-label="Main">
        <ul class="header-list">
          ${items}
          <li class="header-item">${link(PRICING_LINK, "header-link")}</li>
        </ul>
      </nav>
      <div class="header-actions">
        ${sessionLinks}
        ${link(OPEN_ACCOUNT_LINK, "btn btn-primary")}
      </div>
      <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="narrow-menu" data-narrow-toggle>${icon("menu")}<span class="sr-only">Open Menu</span></button>
    </div>
  </header>`;
}

function narrowGroup(menu: HeaderMenu): string {
  const listId = `narrow-${menu.id}`;
  const links = menu.links.map((item) => `<li>${link(item, "narrow-link")}</li>`).join("");
  return `<li>
          <button class="narrow-group-trigger" type="button" aria-expanded="false" aria-controls="${listId}" data-narrow-group>${esc(menu.label)}${icon("chevronDown", "icon icon-chevron")}</button>
          <ul class="narrow-group" id="${listId}" hidden>${links}</ul>
        </li>`;
}

function narrowMenu(): string {
  const groups = HEADER_MENUS.map(narrowGroup).join("");
  const sessionLinks = SESSION_LINKS.map((item) => link(item, "narrow-link")).join("");
  return `<div class="narrow-scrim" data-narrow-scrim hidden></div>
  <nav class="narrow-menu" id="narrow-menu" aria-label="Menu" hidden>
    <ul class="narrow-groups">
      ${groups}
      <li>${link(PRICING_LINK, "narrow-link narrow-link-top")}</li>
    </ul>
    <div class="narrow-actions">
      ${sessionLinks}
      ${link(OPEN_ACCOUNT_LINK, "btn btn-primary")}
    </div>
  </nav>`;
}

const GRAIN_FILTER = `<svg class="grain-defs" aria-hidden="true" focusable="false"><filter id="grain-noise" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter></svg>`;

function footer(): string {
  const groups = FOOTER_GROUPS.map((group) => {
    const links = group.links.map((item) => `<li>${link(item, "footer-link")}</li>`).join("");
    return `<div class="footer-group"><p class="footer-title">${esc(group.title)}</p><ul>${links}</ul></div>`;
  }).join("");
  return `<footer class="site-footer">
    <div class="container footer-inner">
      <div class="footer-brand">${brand()}<p class="footer-tagline">Calm banking for companies on the move.</p></div>
      <nav class="footer-groups" aria-label="Footer">${groups}</nav>
      <p class="footer-disclaimer">${esc(PARTNER_DISCLAIMER)}</p>
    </div>
  </footer>`;
}

export function marketingDocument(options: MarketingDocumentOptions): RenderedPage {
  return documentShell({
    title: options.title,
    description: options.description,
    page: options.page,
    bodyClass: options.bodyClass,
    styles: ["/assets/css/marketing.css", ...(options.styles ?? [])],
    scripts: ["/assets/marketing.js", ...(options.scripts ?? [])],
    body: `${header()}
  ${narrowMenu()}
  ${GRAIN_FILTER}
  <main id="main" class="page-main">${options.main}</main>
  ${footer()}`,
  });
}
