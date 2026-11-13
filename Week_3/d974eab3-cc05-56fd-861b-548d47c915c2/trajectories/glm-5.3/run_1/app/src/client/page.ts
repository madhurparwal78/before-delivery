import { CHAPTERS, reducedMotion } from './core.js';

const HEADER_HEIGHT = 64;
const FOCUS_OFFSET = 16;

export function currentHashChapter(): string | null {
  const match = window.location.hash.match(/^#([a-z-]+)$/);
  return match?.[1] ?? null;
}

export function setChapterHash(chapterId: string): void {
  if (window.location.hash === `#${chapterId}`) return;
  const next = `${window.location.pathname}${window.location.search}#${chapterId}`;
  window.history.replaceState(null, '', next);
}

export function currentChapter(): string {
  const point = window.scrollY + window.innerHeight * 0.4;
  if (window.scrollY <= 0) return 'opening';
  let current: string = CHAPTERS[0];
  for (const chapter of CHAPTERS) {
    const element = document.getElementById(chapter);
    if (!element) continue;
    const top = element.offsetTop;
    if (point >= top) current = chapter;
  }
  return current;
}

export function updateRailCurrent(chapterId: string): void {
  for (const chapter of CHAPTERS) {
    const railLink = document.querySelector<HTMLElement>(`[data-rail-chapter="${chapter}"]`);
    if (railLink) {
      if (chapter === chapterId) railLink.setAttribute('aria-current', 'true');
      else railLink.removeAttribute('aria-current');
    }
    const menuLink = document.querySelector<HTMLElement>(`[data-menu-chapter="${chapter}"]`);
    if (menuLink) {
      if (chapter === chapterId) menuLink.setAttribute('aria-current', 'true');
      else menuLink.removeAttribute('aria-current');
    }
  }
}

export function jumpToChapter(chapterId: string, focus = true): void {
  const heading = document.querySelector<HTMLElement>(`#${chapterId} [data-chapter-heading], #${chapterId} .page-heading`);
  const element = document.getElementById(chapterId);
  if (element) {
    const top = element.offsetTop + FOCUS_OFFSET - HEADER_HEIGHT;
    window.scrollTo({ top, behavior: 'instant' as ScrollBehavior });
  }
  if (focus && heading) {
    heading.focus({ preventScroll: true });
  }
  setChapterHash(chapterId);
  updateRailCurrent(chapterId);
}

export function syncHashToView(): void {
  const chapter = currentChapter();
  setChapterHash(chapter);
  updateRailCurrent(chapter);
}

export function initChapterRail(onJump: (chapterId: string) => void): void {
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const link = target?.closest('a[data-rail-chapter], a[data-chapter-jump], a[data-menu-chapter]');
    if (!link) return;
    const chapter = link.getAttribute('data-rail-chapter') ?? link.getAttribute('data-chapter-jump') ?? link.getAttribute('data-menu-chapter');
    if (!chapter || !CHAPTERS.includes(chapter as never)) return;
    if (link.hasAttribute('data-menu-chapter')) return;
    event.preventDefault();
    onJump(chapter);
  });

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const link = target?.closest('a[data-menu-chapter]');
    if (!link) return;
    const chapter = link.getAttribute('data-menu-chapter');
    if (!chapter) return;
    event.preventDefault();
    closeMenu();
    onJump(chapter);
  });

  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(() => {
      ticking = false;
      syncHashToView();
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
}

let menuReturnFocus: HTMLElement | null = null;

export function openMenu(): void {
  const menu = document.querySelector<HTMLElement>('[data-menu]');
  const button = document.querySelector<HTMLElement>('[data-menu-open]');
  if (!menu || !button) return;
  menuReturnFocus = button;
  menu.hidden = false;
  button.setAttribute('aria-expanded', 'true');
  const first = menu.querySelector<HTMLElement>('[data-menu-chapter="opening"]');
  first?.focus();
}

export function closeMenu(): void {
  const menu = document.querySelector<HTMLElement>('[data-menu]');
  const button = document.querySelector<HTMLElement>('[data-menu-open]');
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  button?.setAttribute('aria-expanded', 'false');
  menuReturnFocus?.focus();
  menuReturnFocus = null;
}

export function initMenu(): void {
  const button = document.querySelector<HTMLElement>('[data-menu-open]');
  const menu = document.querySelector<HTMLElement>('[data-menu]');
  if (!button || !menu) return;

  button.addEventListener('click', () => openMenu());

  menu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
      return;
    }
    if (event.key === 'Tab') {
      const focusables = Array.from(
        menu.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
      ).filter((element) => element.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  menu.querySelector('[data-menu-close]')?.addEventListener('click', () => closeMenu());
}

export function initSkipLink(): void {
  document.querySelector('.skip')?.addEventListener('click', (event) => {
    event.preventDefault();
    const main = document.getElementById('main-top');
    main?.focus({ preventScroll: true });
  });
}

export function initHeroWords(): void {
  const heading = document.querySelector<HTMLElement>('[data-hero-heading]');
  if (!heading) return;
  const words = Array.from(heading.querySelectorAll<HTMLElement>('[data-word]'));
  if (reducedMotion() || words.length === 0) {
    for (const word of words) word.classList.add('word-settled');
    return;
  }
  words.forEach((word, index) => {
    window.setTimeout(() => word.classList.add('word-settled'), 80 + index * 100);
  });
}

export function initChapterHeadingReveals(): void {
  const headings = Array.from(document.querySelectorAll<HTMLElement>('.chapter-heading'));
  if (reducedMotion()) {
    for (const heading of headings) heading.classList.add('heading-settled');
    return;
  }
  const revealed = new Set<HTMLElement>();
  const check = () => {
    for (const heading of headings) {
      if (revealed.has(heading)) continue;
      const box = heading.getBoundingClientRect();
      if (box.top < window.innerHeight && box.bottom > 0) {
        revealed.add(heading);
        heading.classList.add('heading-settled');
      }
    }
  };
  window.addEventListener('scroll', () => window.requestAnimationFrame(check), { passive: true });
  check();
}
