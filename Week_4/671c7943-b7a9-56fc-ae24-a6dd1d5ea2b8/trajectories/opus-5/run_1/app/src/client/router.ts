import { disposeView, listen, need, query, queryAll, view } from './dom.js';
import {
  CARRY_MS,
  EASE_OUT_STRONG,
  NEIGHBOUR_MS,
  raiseTitleLines,
  reduced,
} from './motion.js';
import { JUMP_TOP, focusWithout } from './focus.js';
import { startReveals } from './reveal.js';
import { initHome } from './homeView.js';
import { initCase } from './caseView.js';

type Motion =
  | { kind: 'none' }
  | { kind: 'carry'; from: DOMRect }
  | { kind: 'slide'; direction: 'previous' | 'next' };

interface SavedHome {
  main: HTMLElement;
  title: string;
}

let savedHome: SavedHome | null = null;
let originSlug: string | null = null;

const isCase = (root: ParentNode): boolean => query('[data-case]', root) !== null;
const isHome = (root: ParentNode): boolean => query('#intro', root) !== null;

function carry(hero: HTMLElement, from: DOMRect): void {
  const to = hero.getBoundingClientRect();
  const transform = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${
    from.width / to.width
  }, ${from.height / to.height})`;
  hero.style.transformOrigin = 'top left';
  hero.style.transform = transform;
  const animation = hero.animate([{ transform }, { transform: 'none' }], {
    duration: CARRY_MS,
    easing: EASE_OUT_STRONG,
  });
  const finish = (): void => {
    hero.style.transform = '';
    hero.style.transformOrigin = '';
    raiseTitleLines(view());
  };
  animation.finished.then(finish, finish);
}

function slide(oldHero: HTMLElement | null, newHero: HTMLElement, direction: 'previous' | 'next'): void {
  const away = direction === 'next' ? -40 : 40;
  if (oldHero) {
    const box = oldHero.getBoundingClientRect();
    oldHero.remove();
    oldHero.style.position = 'fixed';
    oldHero.style.margin = '0';
    oldHero.style.left = `${box.left}px`;
    oldHero.style.top = `${box.top}px`;
    oldHero.style.width = `${box.width}px`;
    oldHero.style.height = `${box.height}px`;
    document.body.append(oldHero);
    const leaving = oldHero.animate(
      [
        { transform: 'translateX(0)', opacity: '1' },
        { transform: `translateX(${away}px)`, opacity: '0' },
      ],
      { duration: NEIGHBOUR_MS, easing: EASE_OUT_STRONG },
    );
    leaving.finished.then(
      () => oldHero.remove(),
      () => oldHero.remove(),
    );
  }
  const entering = newHero.animate(
    [
      { transform: `translateX(${-away}px)`, opacity: '0' },
      { transform: 'translateX(0)', opacity: '1' },
    ],
    { duration: NEIGHBOUR_MS, easing: EASE_OUT_STRONG },
  );
  entering.finished.then(
    () => raiseTitleLines(view()),
    () => raiseTitleLines(view()),
  );
}

export function initView(first: boolean): void {
  const root = view();
  if (isCase(root)) initCase(root, first);
  else if (isHome(root)) initHome(root, first);
  startReveals();
  bindNavigation(root);
}

async function navigate(href: string, motion: Motion, push: boolean): Promise<void> {
  const response = await fetch(href, { headers: { accept: 'text/html' } });
  const document_ = new DOMParser().parseFromString(await response.text(), 'text/html');
  const fresh = document_.querySelector('[data-view]');
  if (!fresh) {
    window.location.assign(href);
    return;
  }
  const current = view();
  const oldHero = query<HTMLElement>('[data-hero]', current);
  if (isHome(current)) savedHome = { main: current, title: document.title };
  disposeView();
  const next = document.importNode(fresh, true) as HTMLElement;
  current.replaceWith(next);
  document.title = document_.title;
  if (push) window.history.pushState({ href }, '', href);
  window.scrollTo({ top: 0, behavior: 'instant' });
  initView(false);
  const heading = need<HTMLElement>('h1', next);
  focusWithout(heading);
  if (reduced()) return;
  const hero = query<HTMLElement>('[data-hero]', next);
  if (hero && motion.kind === 'carry') carry(hero, motion.from);
  else if (hero && motion.kind === 'slide') slide(oldHero, hero, motion.direction);
  else raiseTitleLines(next);
}

function restoreHome(): void {
  const home = savedHome;
  if (!home) {
    window.location.reload();
    return;
  }
  const current = view();
  const hero = query<HTMLElement>('[data-hero]', current);
  const heroBox = hero ? hero.getBoundingClientRect() : null;
  disposeView();
  current.replaceWith(home.main);
  document.title = home.title;
  savedHome = null;
  initView(false);
  const item = query<HTMLElement>(`[data-project="${originSlug}"]`, home.main);
  if (!item) return;
  const box = item.getBoundingClientRect();
  window.scrollTo({
    top: Math.max(0, window.scrollY + box.top - JUMP_TOP),
    behavior: 'instant',
  });
  const cover = query<HTMLElement>('[data-cover]', item);
  if (cover && heroBox && !reduced()) {
    const to = cover.getBoundingClientRect();
    const transform = `translate(${heroBox.left - to.left}px, ${heroBox.top - to.top}px) scale(${
      heroBox.width / to.width
    }, ${heroBox.height / to.height})`;
    cover.style.transformOrigin = 'top left';
    const animation = cover.animate([{ transform }, { transform: 'none' }], {
      duration: CARRY_MS,
      easing: EASE_OUT_STRONG,
    });
    const finish = (): void => {
      cover.style.transformOrigin = '';
    };
    animation.finished.then(finish, finish);
  }
  const link = query<HTMLElement>('[data-work-link]', item);
  if (link) focusWithout(link);
}

const plainClick = (event: MouseEvent): boolean =>
  !event.defaultPrevented &&
  event.button === 0 &&
  !event.metaKey &&
  !event.ctrlKey &&
  !event.shiftKey &&
  !event.altKey;

function bindNavigation(root: HTMLElement): void {
  for (const link of queryAll<HTMLAnchorElement>('[data-work-link]', root)) {
    listen(link, 'click', (event) => {
      if (!plainClick(event)) return;
      event.preventDefault();
      const item = link.closest<HTMLElement>('[data-project]');
      const cover = item ? query<HTMLElement>('[data-cover]', item) : null;
      originSlug = link.dataset.workLink ?? null;
      void navigate(
        link.href,
        cover ? { kind: 'carry', from: cover.getBoundingClientRect() } : { kind: 'none' },
        true,
      );
    });
  }

  for (const link of queryAll<HTMLAnchorElement>('[data-neighbour]', root)) {
    listen(link, 'click', (event) => {
      if (!plainClick(event)) return;
      event.preventDefault();
      void navigate(
        link.href,
        { kind: 'slide', direction: link.dataset.neighbour as 'previous' | 'next' },
        true,
      );
    });
  }

  if (!isCase(root)) return;
  listen(document, 'keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const active = document.activeElement;
    if (
      active instanceof Element &&
      active.closest('input, textarea, select, [role="radiogroup"], [role="tablist"]')
    ) {
      return;
    }
    const link = query<HTMLAnchorElement>(
      `[data-neighbour="${event.key === 'ArrowLeft' ? 'previous' : 'next'}"]`,
      view(),
    );
    if (!link) return;
    event.preventDefault();
    link.click();
  });
}

export function initRouter(): void {
  window.history.scrollRestoration = 'manual';
  window.addEventListener('popstate', () => {
    const url = new URL(window.location.href);
    if (url.pathname === '/') {
      if (!isHome(view())) restoreHome();
      return;
    }
    if (url.pathname.startsWith('/work/')) {
      void navigate(url.href, { kind: 'none' }, false);
      return;
    }
    window.location.assign(url.href);
  });
}
