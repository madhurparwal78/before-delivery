/**
 * The document every page is delivered in. The heading and the text are in this
 * first response, so a page reads with no script run.
 */
import { escapeHtml } from '../domain/markup.ts';
import { REGION } from '../../shared/feedback.ts';

export interface Document {
  title: string;
  lang: string;
  dir: 'ltr' | 'rtl';
  /** The page's own markup, inside `<main>`. */
  main: string;
  header: string;
  /** What the client script needs to carry on from here. */
  screen: string;
  /** Regions named in the client's language on the client page. */
  regions?: { announcements: string; refreshState: string };
  bodyClass?: string;
}

export function renderDocument(page: Document): string {
  const regions = page.regions ?? {
    announcements: REGION.announcements,
    refreshState: REGION.refreshState,
  };
  return `<!doctype html>
<html lang="${escapeHtml(page.lang)}" dir="${page.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(page.title)}</title>
<link rel="stylesheet" href="/assets/desk.css">
<link rel="icon" href="data:,">
</head>
<body class="${escapeHtml(page.bodyClass ?? '')}" data-screen="${escapeHtml(page.screen)}">
<div role="status" aria-live="polite" aria-label="${escapeHtml(regions.announcements)}" id="announcements" class="announcements"></div>
<div role="status" aria-label="${escapeHtml(regions.refreshState)}" id="refresh-state" class="refresh-state"></div>
${page.header}
<main id="main">${page.main}</main>
<script type="module" src="/assets/desk.js"></script>
</body>
</html>`;
}

export const PUBLIC_HEADER = `<header class="site-header" id="site-header" data-scrolled="false">
  <a class="wordmark" href="/">Bottega Semenza</a>
  <nav class="site-nav">
    <button type="button" id="work-button" aria-expanded="false" aria-controls="work-panel">Work</button>
    <a href="/enquire">Enquire</a>
    <a href="/sign-in">Sign in</a>
  </nav>
  <div id="work-panel" class="work-panel" hidden></div>
</header>`;

export const DESK_LINKS: readonly { href: string; label: string }[] = [
  { href: '/pieces', label: 'Pieces' },
  { href: '/clients', label: 'Clients' },
  { href: '/library', label: 'Library' },
  { href: '/bench', label: 'Bench' },
  { href: '/workbook', label: 'Workbook' },
  { href: '/rates', label: 'Rates' },
];

export function deskHeader(current: string): string {
  const links = DESK_LINKS.map(
    (link) =>
      `<a href="${link.href}"${link.href === current ? ' aria-current="page"' : ''}>${link.label}</a>`,
  ).join('');
  return `<header class="desk-header" id="desk-header">
  <nav class="desk-nav" id="desk-nav">${links}</nav>
  <div class="desk-search">
    <label class="visually-hidden" for="desk-search-input">Search the desk</label>
    <input type="search" id="desk-search-input" role="searchbox" aria-label="Search the desk" autocomplete="off">
    <ul class="search-results" id="search-results" aria-label="Search results" hidden></ul>
  </div>
  <div class="desk-actions" id="desk-actions">
    <button type="button" id="change-password">Change password</button>
    <button type="button" id="sign-out">Sign out</button>
  </div>
  <button type="button" id="menu-button" class="menu-button">Menu</button>
</header>`;
}
