import { FOOTER, NAV_SECTIONS, PRIVACY } from '../content/copy.js';
import { STUDIO_EMAIL_ADDRESS } from '../shared/copy.js';
import { escapeHtml } from './html.js';

const navLinks = (): string =>
  NAV_SECTIONS.map(
    (section) =>
      `<a class="nav__link" href="/#${section.id}" data-nav="${section.id}">${escapeHtml(
        section.navName,
      )}</a>`,
  ).join('');

const header = (): string => `<header class="header">
  <div class="header__inner">
    <a class="header__home" href="/" aria-label="Sollis Studio home"><span aria-hidden="true">Sollis Studio</span></a>
    <nav class="header__nav" aria-label="Main">${navLinks()}</nav>
    <button class="header__menu" type="button" data-menu-open>Menu</button>
  </div>
</header>
<dialog class="menu" aria-label="Menu" data-menu>
  <div class="menu__panel" data-menu-panel>
    <button class="menu__close" type="button" data-menu-close>Close menu</button>
    <nav class="menu__nav" aria-label="Menu sections">${navLinks()}</nav>
  </div>
</dialog>`;

const footer = (): string => `<footer class="footer">
  <div class="footer__inner">
    <div class="footer__copy">
      ${FOOTER.texts.map((text) => `<p>${escapeHtml(text)}</p>`).join('\n      ')}
    </div>
    <nav class="footer__nav" aria-label="Footer">
      ${NAV_SECTIONS.map(
        (section) => `<a href="/#${section.id}">${escapeHtml(section.navName)}</a>`,
      ).join('\n      ')}
      <a href="/privacy">${escapeHtml(PRIVACY.heading)}</a>
    </nav>
    <nav class="footer__social" aria-label="Social">
      ${FOOTER.social
        .map(
          (link) =>
            `<a href="${link.href}" target="_blank" rel="noopener noreferrer">${escapeHtml(
              link.name,
            )}<span class="sr-only"> (opens in a new tab)</span></a>`,
        )
        .join('\n      ')}
    </nav>
    <p class="footer__contact"><a href="mailto:${STUDIO_EMAIL_ADDRESS}">${escapeHtml(
      STUDIO_EMAIL_ADDRESS,
    )}</a></p>
    <p class="footer__legal">${escapeHtml(FOOTER.copyright)}</p>
  </div>
</footer>`;

export interface PageOptions {
  title: string;
  headingId: string;
  main: string;
}

export function renderPage(options: PageOptions): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)}</title>
<link rel="stylesheet" href="/assets/app.css">
<link rel="preload" href="/assets/fonts/instrument-serif-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/instrument-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
</head>
<body>
<a class="skip-link" href="#${escapeHtml(options.headingId)}" data-skip>Skip to content</a>
${header()}
<main id="main" class="main" data-view>
${options.main}
</main>
${footer()}
<div class="sr-only" role="status" aria-label="Site updates" data-status></div>
<script type="module" src="/assets/app.js"></script>
</body>
</html>`;
}
