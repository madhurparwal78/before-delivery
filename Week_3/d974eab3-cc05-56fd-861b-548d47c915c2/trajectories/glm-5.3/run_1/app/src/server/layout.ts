import { CHAPTERS } from '../domain/seed.js';
import { SITE_COPY } from '../domain/copy.js';
import { escapeXml } from './xml.js';

export interface PageMeta {
  title: string;
}

export function layout(meta: PageMeta, body: string): string {
  const chapters = CHAPTERS.map((chapter) => chapter.id).join(',');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeXml(meta.title)}</title>
<link rel="stylesheet" href="/css/vireo.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<script src="/js/vireo.js" defer></script>
</head>
<body data-chapters="${chapters}">
<a class="skip" href="#main-top">Skip to story</a>
<header class="site-header" role="banner">
  <a class="home-link" href="/">Alder Quay<span class="visually-hidden"> Laboratories</span> home</a>
  <nav class="site-nav" role="navigation" aria-label="Site">
    <a href="/#about">About</a>
    <a href="/#science">Science &amp; Technology</a>
    <a href="/#product">Product</a>
    <a href="/#interviews">Interview</a>
    <a href="/store">Online store</a>
  </nav>
  <button class="menu-button" type="button" data-menu-open aria-haspopup="dialog" aria-expanded="false" aria-controls="site-menu">Menu</button>
</header>
<div class="menu-layer" id="site-menu" role="dialog" aria-modal="true" aria-label="Menu" data-menu hidden>
  <button class="menu-close" type="button" data-menu-close>Close menu</button>
  <nav class="menu-chapters" role="navigation" aria-label="Menu chapters">
    ${CHAPTERS.map((chapter) => `<a href="/#${chapter.id}" data-menu-chapter="${chapter.id}">${chapter.num} ${escapeXml(chapter.title)}</a>`).join('\n    ')}
  </nav>
  <div class="menu-extra">
    <a href="/store">Online store</a>
    <a href="/contact">Contact</a>
  </div>
</div>
<main id="main-top" tabindex="-1">
${body}
</main>
<footer role="contentinfo">
  <p class="footer-company">${escapeXml(SITE_COPY.footer.company)}</p>
  <p>${escapeXml(SITE_COPY.footer.fictional)}</p>
  <p>${escapeXml(SITE_COPY.footer.copyright)}</p>
  <nav role="navigation" aria-label="Footer">
    <a href="/#about">About</a>
    <a href="/#science">Science &amp; Technology</a>
    <a href="/#product">Product</a>
    <a href="/#interviews">Interview</a>
    <a href="/store">Online store</a>
    <a href="/contact">Contact</a>
    <a href="/privacy">Privacy</a>
    <a href="/legal">Legal</a>
  </nav>
</footer>
<div class="status" role="status" aria-live="polite" aria-label="Story updates" data-status></div>
</body>
</html>`;
}
