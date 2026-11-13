import { CHAPTERS, chapterNumber } from '../shared/chapters';
import { escapeHtml } from '../shared/escape';
import { STATUS_REGION_NAME } from '../shared/messages';
import type { SiteCopy } from '../shared/types';

export type PageName =
  | 'story'
  | 'interview'
  | 'interview-missing'
  | 'store'
  | 'contact'
  | 'privacy'
  | 'legal'
  | 'not-found';

const SITE_LINKS = [
  { label: 'About', href: '/#about' },
  { label: 'Science & Technology', href: '/#science' },
  { label: 'Product', href: '/#product' },
  { label: 'Interview', href: '/#interviews' },
  { label: 'Online store', href: '/store' },
] as const;

const FOOTER_LINKS = [
  ...SITE_LINKS,
  { label: 'Contact', href: '/contact' },
  { label: 'Privacy', href: '/privacy' },
  { label: 'Legal', href: '/legal' },
] as const;

function chapterStops(): string {
  return CHAPTERS.map(
    (chapter, index) =>
      `<li><a class="chapter-stop" href="/#${chapter.id}" data-chapter-link="${chapter.id}" data-chapter-stop="${chapter.id}">` +
      `<span class="chapter-stop__number">${chapterNumber(index)}</span> ` +
      `<span class="chapter-stop__title">${escapeHtml(chapter.title)}</span></a></li>`,
  ).join('');
}

function header(): string {
  return `<header class="site-header">
<a class="home-link" href="/" aria-label="Alder Quay Laboratories home"><span aria-hidden="true">Alder Quay Laboratories</span></a>
<nav class="site-nav" aria-label="Site"><ul>${SITE_LINKS.map(
    (link) =>
      `<li><a href="${link.href}"${link.href.startsWith('/#') ? ` data-chapter-link="${link.href.slice(2)}"` : ''}>${escapeHtml(link.label)}</a></li>`,
  ).join('')}</ul></nav>
<button type="button" class="menu-button" data-menu-open>Menu</button>
</header>`;
}

function rail(): string {
  return `<nav class="chapter-rail" aria-label="Chapters"><ol>${chapterStops()}</ol></nav>`;
}

function menuDialog(): string {
  return `<div class="menu-dialog" role="dialog" aria-modal="true" aria-label="Menu" data-menu-dialog hidden>
<div class="menu-dialog__panel">
<button type="button" class="menu-dialog__close" data-menu-close>Close menu</button>
<nav class="menu-dialog__chapters" aria-label="Menu chapters"><ol>${chapterStops()}</ol></nav>
<ul class="menu-dialog__pages"><li><a href="/store">Online store</a></li><li><a href="/contact">Contact</a></li></ul>
</div>
</div>`;
}

function footer(site: SiteCopy): string {
  return `<footer class="site-footer">
<div class="site-footer__copy">
<p class="site-footer__name">${escapeHtml(site.footer.name)}</p>
<p>${escapeHtml(site.footer.line)}</p>
<p>${escapeHtml(site.footer.copyright)}</p>
</div>
<nav class="site-footer__nav" aria-label="Footer"><ul>${FOOTER_LINKS.map(
    (link) =>
      `<li><a href="${link.href}"${link.href.startsWith('/#') ? ` data-chapter-link="${link.href.slice(2)}"` : ''}>${escapeHtml(link.label)}</a></li>`,
  ).join('')}</ul></nav>
</footer>`;
}

export interface PageOptions {
  page: PageName;
  title: string;
  site: SiteCopy;
  /** The id of the first heading of the main content. */
  skipTarget: string;
  main: string;
  withRail: boolean;
}

export function renderPage(options: PageOptions): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)}</title>
<link rel="stylesheet" href="/assets/site.css">
</head>
<body data-page="${options.page}">
<a class="skip-link" href="#${options.skipTarget}" data-skip-link>Skip to story</a>
${header()}
${options.withRail ? rail() : ''}
<main id="main" class="site-main">${options.main}</main>
${footer(options.site)}
<div class="visually-hidden" role="status" aria-live="polite" aria-label="${STATUS_REGION_NAME}" data-status></div>
${menuDialog()}
<script src="/assets/client.js" defer></script>
</body>
</html>`;
}
