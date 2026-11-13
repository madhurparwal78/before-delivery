import {
  FIRST_CHAPTER_ID,
  isChapterId,
  type ChapterId,
} from '../shared/chapters';
import { CURRENT_CHAPTER_PROBE } from '../shared/progress';
import {
  all,
  documentTop,
  find,
  need,
  prefersReducedMotion,
  scrollPageTo,
} from './dom';

const MENU_CLOSE_MS = 280;
/** A jump by link arrives within one second; the chapter is fixed until then. */
const JUMP_SETTLE_MS = 1000;

function maxScroll(): number {
  return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
}

function headingOf(region: Element): HTMLElement {
  return need<HTMLElement>('[id$="-heading"]', region);
}

export class ChapterNavigation {
  private readonly regions: HTMLElement[];
  private current: ChapterId = FIRST_CHAPTER_ID;
  private menuOpen = false;
  private settleAt = 0;

  constructor() {
    this.regions = all<HTMLElement>('[data-chapter]');
  }

  hasChapters(): boolean {
    return this.regions.length > 0;
  }

  /** The chapter whose box holds the point 40% of the way down the viewport. */
  currentChapterId(): ChapterId {
    const probe = window.scrollY + window.innerHeight * CURRENT_CHAPTER_PROBE;
    let found: ChapterId = FIRST_CHAPTER_ID;
    for (const region of this.regions) {
      const id = region.dataset['chapter'];
      if (id === undefined || !isChapterId(id)) {
        continue;
      }
      const top = documentTop(region);
      if (probe >= top && probe < top + region.offsetHeight) {
        return id;
      }
      if (probe >= top) {
        found = id;
      }
    }
    return found;
  }

  regionOf(chapterId: ChapterId): HTMLElement | null {
    return (
      this.regions.find((region) => region.dataset['chapter'] === chapterId) ??
      null
    );
  }

  /** Marks the current stop in the rail, and in the menu while it is open. */
  private markStops(): void {
    const dialog = find('[data-menu-dialog]');
    for (const stop of all<HTMLElement>('[data-chapter-stop]')) {
      const inMenu = dialog?.contains(stop) === true;
      const active =
        stop.dataset['chapterStop'] === this.current &&
        (!inMenu || this.menuOpen);
      if (active) {
        stop.setAttribute('aria-current', 'true');
      } else {
        stop.removeAttribute('aria-current');
      }
    }
  }

  /** The hash is replaced, so no history entry is added and the query stays. */
  private writeHash(): void {
    const url = new URL(window.location.href);
    if (url.hash === `#${this.current}`) {
      return;
    }
    url.hash = this.current;
    window.history.replaceState(window.history.state, '', url);
  }

  /** Follows the scroll in either direction. */
  syncCurrentChapter(): void {
    if (performance.now() < this.settleAt) {
      return;
    }
    const next = this.currentChapterId();
    if (next === this.current) {
      return;
    }
    this.current = next;
    this.markStops();
    this.writeHash();
  }

  setCurrentChapter(chapterId: ChapterId): void {
    this.current = chapterId;
    this.markStops();
    this.writeHash();
  }

  /**
   * Ends with the chapter heading clear of the header and focused. Every
   * chapter's content starts below the header, so the region's own top is the
   * landing point.
   */
  jumpTo(chapterId: ChapterId, smooth: boolean): void {
    const region = this.regionOf(chapterId);
    if (region === null) {
      window.location.assign(`/#${chapterId}`);
      return;
    }
    const animate = smooth && !prefersReducedMotion();
    this.settleAt = animate ? performance.now() + JUMP_SETTLE_MS : 0;
    scrollPageTo(
      Math.min(Math.max(0, documentTop(region)), maxScroll()),
      animate,
    );
    headingOf(region).focus({ preventScroll: true });
    this.setCurrentChapter(chapterId);
  }

  setMenuOpen(open: boolean): void {
    this.menuOpen = open;
    this.markStops();
  }
}

function setupSkipLink(): void {
  const link = need<HTMLAnchorElement>('[data-skip-link]');
  link.addEventListener('click', (event) => {
    event.preventDefault();
    document.getElementById(link.hash.slice(1))?.focus();
  });
}

function setupMenu(navigation: ChapterNavigation): void {
  const dialog = need<HTMLElement>('[data-menu-dialog]');
  const openButton = need<HTMLButtonElement>('[data-menu-open]');
  const closeButton = need<HTMLButtonElement>('[data-menu-close]', dialog);
  let closeTimer = 0;

  const outside = (): HTMLElement[] =>
    all<HTMLElement>('body > *').filter(
      (element) => element !== dialog && !element.hasAttribute('data-status'),
    );
  const focusables = (): HTMLElement[] =>
    all<HTMLElement>('button, a[href]', dialog);

  const open = (): void => {
    window.clearTimeout(closeTimer);
    dialog.hidden = false;
    dialog.inert = false;
    for (const element of outside()) {
      element.inert = true;
    }
    navigation.setMenuOpen(true);
    requestAnimationFrame(() => {
      dialog.classList.add('is-open');
    });
    need<HTMLElement>('[data-chapter-stop="opening"]', dialog).focus();
  };

  const close = (): void => {
    if (dialog.hidden) {
      return;
    }
    dialog.classList.remove('is-open');
    dialog.inert = true;
    navigation.setMenuOpen(false);
    for (const element of outside()) {
      element.inert = false;
    }
    openButton.focus();
    if (prefersReducedMotion()) {
      dialog.hidden = true;
    } else {
      closeTimer = window.setTimeout(() => {
        dialog.hidden = true;
      }, MENU_CLOSE_MS);
    }
  };

  openButton.addEventListener('click', open);
  closeButton.addEventListener('click', close);
  for (const link of all<HTMLAnchorElement>('a[href]', dialog)) {
    link.addEventListener('click', close);
  }
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const stops = focusables();
    const first = stops[0];
    const last = stops.at(-1);
    if (first === undefined || last === undefined) {
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

/** Chapter links, the address hash and the chapter rail. */
export function setupNavigation(): ChapterNavigation {
  const navigation = new ChapterNavigation();
  setupSkipLink();
  setupMenu(navigation);

  if (!navigation.hasChapters()) {
    return navigation;
  }

  for (const link of all<HTMLAnchorElement>('[data-chapter-link]')) {
    const chapterId = link.dataset['chapterLink'];
    if (chapterId === undefined || !isChapterId(chapterId)) {
      continue;
    }
    link.addEventListener('click', (event) => {
      event.preventDefault();
      navigation.jumpTo(chapterId, true);
    });
  }

  window.addEventListener('scroll', () => {
    navigation.syncCurrentChapter();
  });
  window.addEventListener('hashchange', () => {
    const wanted = window.location.hash.slice(1);
    if (isChapterId(wanted)) {
      navigation.jumpTo(wanted, false);
    }
  });
  return navigation;
}

/**
 * A load of `/#<chapter id>` lands on that chapter with no scroll motion and
 * focuses its heading. A load without a hash gets `#opening` at once.
 */
export function openAddressedChapter(navigation: ChapterNavigation): void {
  const wanted = window.location.hash.slice(1);
  if (isChapterId(wanted)) {
    navigation.jumpTo(wanted, false);
    return;
  }
  navigation.setCurrentChapter(FIRST_CHAPTER_ID);
}
