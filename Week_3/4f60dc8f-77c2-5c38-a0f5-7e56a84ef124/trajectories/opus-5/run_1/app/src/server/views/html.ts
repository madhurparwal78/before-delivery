export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const attr = (value: string): string => escapeHtml(value);

export const NAV_LINKS: { label: string; href: string }[] = [
  { label: '01 Work', href: '/#work' },
  { label: '02 Services', href: '/#services' },
  { label: '03 Studio', href: '/#studio' },
  { label: '04 Insights', href: '/#insights' },
  { label: '05 Start a project', href: '/start' },
];

export const STUDIO_NAME = 'Gloamwork';

const navigation = (): string => `
<nav aria-label="Main" class="nav" data-nav>
  <a class="nav-brand" href="/">${STUDIO_NAME}</a>
  <button type="button" class="nav-menu" data-nav-toggle aria-expanded="false" hidden>Menu</button>
  <ul class="nav-links" data-nav-links>
    ${NAV_LINKS.map((link) => `<li><a href="${attr(link.href)}">${escapeHtml(link.label)}</a></li>`).join('\n    ')}
  </ul>
</nav>`;

export const searchLandmark = (): string => `
<search role="search" class="studio-search" data-search>
  <form class="search-form" data-search-form>
    <label class="search-label" for="studio-search-input">Search the studio</label>
    <input type="search" id="studio-search-input" aria-label="Search the studio" autocomplete="off" data-search-input>
  </form>
  <div role="status" aria-label="Search status" class="search-status" data-search-status></div>
  <div class="search-panel" data-search-panel hidden></div>
</search>`;

export type ShellOptions = {
  title: string;
  main: string;
  bootstrap?: Record<string, unknown>;
  withSearch?: boolean;
  bodyClass?: string;
};

export const shell = (options: ShellOptions): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)} &middot; ${STUDIO_NAME}</title>
<link rel="preload" href="/fonts/bricolage-grotesque-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/manrope-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/app.css">
</head>
<body class="${attr(options.bodyClass ?? '')}">
<a class="skip-link" href="#main">Skip to content</a>
<header class="page-header">
${navigation()}
${options.withSearch === true ? searchLandmark() : ''}
</header>
<div class="outage" role="alert" data-outage hidden></div>
<main id="main" class="page-main" data-page>
${options.main}
</main>
<footer class="page-footer">${STUDIO_NAME}</footer>
<script type="application/json" id="gw-bootstrap">${JSON.stringify(options.bootstrap ?? {}).replace(/</g, '\\u003c')}</script>
<script type="module" src="/app.js"></script>
</body>
</html>`;
