/** Section jumps, their history entries and the current section marking. */

import { CURRENT_SECTION_LINE, lastTargetAboveLine } from '../shared/rules.js';
import {
  JUMP_OFFSET,
  focusPlaced,
  focusWithRule,
  headingOf,
  need,
  onScrollOrResize,
  query,
  queryAll,
  reducedMotion,
  runScrollRules,
} from './dom.js';

export interface JumpState {
  readonly returnSlug?: string;
}

export const historyState = (): JumpState =>
  (history.state as JumpState | null) ?? ({} as JumpState);

/** The address as the brief publishes it, with commas left unencoded. */
const addressOf = (url: URL): string =>
  `${url.pathname}${url.search.replace(/%2C/g, ',')}${url.hash}`;

export const replaceAddress = (url: URL, state: JumpState = historyState()): void => {
  history.replaceState(state, '', addressOf(url));
};

export const pushAddress = (url: URL, state: JumpState = {}): void => {
  history.pushState(state, '', addressOf(url));
};

export const currentUrl = (): URL => new URL(window.location.href);

const maxScroll = (): number =>
  Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

const scrollToHeading = (heading: HTMLElement, behavior: ScrollBehavior): void => {
  const top = Math.min(
    maxScroll(),
    Math.max(0, window.scrollY + heading.getBoundingClientRect().top - JUMP_OFFSET),
  );
  window.scrollTo({ top, behavior });
};

/** The section the latest jump is heading for, so an older glide never corrects. */
let gliding: string | null = null;

/**
 * A panel opening or a picture arriving can change the page's height while a
 * glide is in flight, so the landing position is settled once it ends.
 */
const settleAfterGlide = (id: string): void => {
  gliding = id;
  const settle = (): void => {
    if (gliding !== id) return;
    gliding = null;
    const section = document.getElementById(id);
    if (section === null) return;
    const heading = headingOf(section);
    if (Math.abs(heading.getBoundingClientRect().top - JUMP_OFFSET) <= 1) return;
    scrollToHeading(heading, 'instant');
    runScrollRules();
  };
  window.addEventListener('scrollend', settle, { once: true });
};

/** Lands a section's heading 16 px below the header and gives it focus. */
export const jumpToSection = (id: string, glide: boolean): boolean => {
  const section = document.getElementById(id);
  if (section === null) return false;
  const heading = headingOf(section);
  const smooth = glide && !reducedMotion();
  scrollToHeading(heading, smooth ? 'smooth' : 'instant');
  focusPlaced(heading);
  runScrollRules();
  if (smooth) settleAfterGlide(id);
  return true;
};

const jumpToTop = (glide: boolean): void => {
  window.scrollTo({ top: 0, behavior: glide && !reducedMotion() ? 'smooth' : 'instant' });
  focusPlaced(need<HTMLElement>('h1'));
  runScrollRules();
};

const navLinkSelector = '.site-nav-link, .menu-link';

const markCurrentSection = (): void => {
  const targets = queryAll<HTMLElement>('[data-section]')
    .filter((section) => section.dataset.section !== 'intro' && section.dataset.section !== 'numbers')
    .map((section) => ({ id: section.id, top: section.getBoundingClientRect().top }));
  const current = lastTargetAboveLine(targets, window.innerHeight, CURRENT_SECTION_LINE);
  for (const link of queryAll<HTMLElement>(navLinkSelector)) {
    if (link.dataset.navLink === current) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  }
};

export const watchCurrentSection = (): void => {
  onScrollOrResize(markCurrentSection);
};

const sectionIdFromHash = (hash: string): string | null =>
  hash.startsWith('#') && hash.length > 1 ? hash.slice(1) : null;

/** Whether a link points at a section of the page the visitor is already on. */
const sameDocumentHash = (link: HTMLAnchorElement): string | null => {
  const url = new URL(link.href, window.location.href);
  if (url.origin !== window.location.origin || url.pathname !== window.location.pathname) {
    return null;
  }
  return sectionIdFromHash(url.hash);
};

export const watchJumpLinks = (): void => {
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest('a');
    if (link === null) return;
    const id = sameDocumentHash(link);
    if (id === null) return;
    if (document.getElementById(id) === null) return;
    event.preventDefault();
    const url = currentUrl();
    url.hash = `#${id}`;
    pushAddress(url);
    jumpToSection(id, true);
  });
};

/** `Skip to content` moves focus to the level-1 heading, with no history entry. */
export const watchSkipLink = (): void => {
  const link = query<HTMLAnchorElement>('[data-skip-link]');
  link?.addEventListener('click', (event) => {
    event.preventDefault();
    focusWithRule(need<HTMLElement>('h1'));
  });
};

/** `Ottoline Rask home` and `Back to top` bring the top of the page into view. */
export const watchTopLinks = (): void => {
  const homeLink = query<HTMLAnchorElement>('[data-home-link]');
  const backToTop = query<HTMLElement>('[data-back-to-top]');
  const goTop = (): void => {
    const url = currentUrl();
    url.hash = '';
    pushAddress(url);
    jumpToTop(true);
  };
  homeLink?.addEventListener('click', (event) => {
    const url = new URL(homeLink.href, window.location.href);
    if (url.pathname !== window.location.pathname) return;
    event.preventDefault();
    goTop();
  });
  backToTop?.addEventListener('click', goTop);
};

export interface ArrivalHooks {
  /** Returns true when the arrival was handled, as the gallery return does. */
  readonly handled?: () => boolean;
}

/** Whether the visitor arrived by a link, or by Back or Forward. */
const arrivedFromTheSite = (): boolean => {
  const entry = performance.getEntriesByType('navigation')[0];
  if (entry instanceof PerformanceNavigationTiming && entry.type === 'back_forward') return true;
  return document.referrer !== '' && document.referrer.startsWith(`${window.location.origin}/`);
};

export const handleArrival = (hooks: ArrivalHooks = {}): void => {
  if (hooks.handled?.() === true) return;
  const id = sectionIdFromHash(window.location.hash);
  if (id !== null && jumpToSection(id, false)) return;
  if (arrivedFromTheSite()) jumpToTop(false);
};

export const watchHistory = (onPop: () => void): void => {
  window.addEventListener('popstate', () => {
    onPop();
    const id = sectionIdFromHash(window.location.hash);
    if (id !== null && jumpToSection(id, false)) return;
    jumpToTop(false);
  });
};
