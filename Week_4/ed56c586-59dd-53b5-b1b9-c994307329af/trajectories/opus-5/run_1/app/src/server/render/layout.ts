/** The document shell shared by every page: header, footer, dialogs and status regions. */

import { CONTACT, FICTION_NOTICE, NAV_LINK_LABELS, NAV_SECTIONS } from '../../shared/seed.js';
import { NEW_TAB_SUFFIX } from '../../shared/text.js';
import { attrs, escapeHtml, glyph, visuallyHidden } from './html.js';

export type PageKind = 'home' | 'case-study' | 'not-found';

export interface SocialLink {
  readonly label: string;
  readonly href: string;
}

export const SOCIAL_LINKS: readonly SocialLink[] = [
  { label: 'Ottoline Rask on GitHub', href: CONTACT.github },
  { label: 'Ottoline Rask on LinkedIn', href: CONTACT.linkedin },
  { label: 'Ottoline Rask on Dribbble', href: CONTACT.dribbble },
];

export const newTabLink = (link: SocialLink, className: string): string =>
  `<a${attrs({
    class: className,
    href: link.href,
    target: '_blank',
    rel: 'noopener noreferrer',
  })}>${escapeHtml(link.label)}${visuallyHidden(` ${NEW_TAB_SUFFIX}`)}${glyph('\u2197')}</a>`;

const sectionLinks = (className: string): string =>
  NAV_SECTIONS.map((section, index) => {
    const label = NAV_LINK_LABELS[index] ?? section.heading;
    return `<a${attrs({ class: className, href: `/#${section.id}`, 'data-nav-link': section.id })}>${escapeHtml(label)}</a>`;
  }).join('');

const header = (): string =>
  '<header class="site-header">' +
  `<a class="wordmark-link" href="/" data-home-link>${escapeHtml('Ottoline Rask')}${visuallyHidden(' home')}</a>` +
  `<nav class="site-nav" aria-label="Sections">${sectionLinks('site-nav-link')}</nav>` +
  '<button type="button" class="menu-button" data-menu-button aria-expanded="false">Menu</button>' +
  '</header>';

const footerWordmark = (): string => {
  let letterIndex = 0;
  const letters = [...'Ottoline Rask']
    .map((character) => {
      if (character === ' ') return '<span class="wordmark-space"> </span>';
      const delay = letterIndex * 40;
      letterIndex += 1;
      return `<span class="wordmark-letter" style="--letter-delay:${delay}ms">${escapeHtml(character)}</span>`;
    })
    .join('');
  return `<p class="footer-wordmark" data-footer-mark>${letters}</p>`;
};

const footer = (): string =>
  '<footer class="site-footer" data-footer>' +
  footerWordmark() +
  `<nav class="footer-nav" aria-label="Footer">${sectionLinks('footer-nav-link')}</nav>` +
  `<div class="footer-social">${SOCIAL_LINKS.map((link) => newTabLink(link, 'footer-social-link')).join('')}</div>` +
  '<button type="button" class="back-to-top" data-back-to-top>Back to top</button>' +
  '<p class="footer-legal">\u00a9 2026 Quillfern Works.</p>' +
  `<p class="footer-notice">${escapeHtml(FICTION_NOTICE)}</p>` +
  '</footer>';

const menuDialog = (): string =>
  '<div class="dialog-layer" data-dialog-layer="menu" hidden>' +
  '<div class="dialog-backdrop" data-menu-backdrop></div>' +
  '<div class="dialog menu-dialog" role="dialog" aria-modal="true" aria-label="Menu" data-menu-dialog>' +
  `<nav class="menu-nav" aria-label="Menu sections">${sectionLinks('menu-link')}</nav>` +
  '<button type="button" class="menu-close" data-menu-close>Close menu</button>' +
  '</div></div>';

const quickLookDialog = (): string =>
  '<div class="dialog-layer" data-dialog-layer="quicklook" hidden>' +
  '<div class="dialog-backdrop" data-quicklook-backdrop></div>' +
  '<div class="dialog quicklook" role="dialog" aria-modal="true" aria-label="Preview" data-quicklook>' +
  '<div class="quicklook-stage media-slot" data-preview-frame data-frame="1" data-media-slot data-media-kind="frame" tabindex="-1">' +
  '<img class="media-image" alt="" src="" data-media-image>' +
  '</div>' +
  '<p class="mono quicklook-status" role="status" data-quicklook-status>Frame 1 of 6</p>' +
  '<div class="quicklook-controls">' +
  '<button type="button" data-quicklook-prev>Previous frame</button>' +
  '<button type="button" data-quicklook-next>Next frame</button>' +
  '<a href="/" data-quicklook-case>Open case study</a>' +
  '<button type="button" data-quicklook-close>Close preview</button>' +
  '</div></div></div>';

export interface DocumentOptions {
  readonly title: string;
  readonly kind: PageKind;
  readonly headingId: string;
  readonly main: string;
  readonly slug?: string;
}

export const renderDocument = (options: DocumentOptions): string =>
  '<!doctype html>\n<html lang="en">' +
  '<head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  `<title>${escapeHtml(options.title)}</title>` +
  '<link rel="stylesheet" href="/site.css">' +
  '<script src="/client.js" defer></script>' +
  '</head>' +
  `<body${attrs({ 'data-page': options.kind, 'data-slug': options.slug ?? null })}>` +
  `<a class="skip-link" href="#${options.headingId}" data-skip-link>Skip to content</a>` +
  header() +
  '<main class="site-main" data-main>' +
  '<div class="media-notice" role="status" aria-label="Media notice" data-media-notice hidden></div>' +
  options.main +
  '</main>' +
  footer() +
  '<p class="visually-hidden" role="status" aria-label="Site updates" data-site-updates></p>' +
  menuDialog() +
  quickLookDialog() +
  '<div class="cursor" data-cursor data-visible="false" data-cursor-state="default" aria-hidden="true">' +
  '<span class="cursor-dot"></span><span class="cursor-label" data-cursor-label></span></div>' +
  '</body></html>';
