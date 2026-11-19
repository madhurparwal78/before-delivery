import { pick, pickAll } from './dom';
import { closeDialog, isOpen, openDialog } from './dialogs';

const WIDE_MENU = '(min-width: 1100px)';
const WIDE_MEGA = '(min-width: 768px)';

/** Below 1100 px the side rail becomes a sheet behind the `Menu` button. */
export function applyFrameWidth(): void {
  const rail = pick<HTMLElement>('[data-part="desk-menu"]');
  if (rail) {
    const wide = window.matchMedia(WIDE_MENU).matches;
    if (wide) {
      rail.removeAttribute('role');
      rail.removeAttribute('aria-modal');
      rail.removeAttribute('inert');
      rail.hidden = false;
      rail.removeAttribute('data-sheet');
      if (isOpen(rail)) closeDialog(rail);
    } else {
      rail.setAttribute('role', 'dialog');
      rail.setAttribute('aria-modal', 'true');
      rail.setAttribute('data-sheet', 'true');
      if (!isOpen(rail)) {
        rail.hidden = true;
        rail.setAttribute('inert', '');
      }
    }
  }

  const mega = pick<HTMLElement>('[data-part="mega-menu"]');
  if (mega) {
    const wide = window.matchMedia(WIDE_MEGA).matches;
    mega.setAttribute('role', wide ? 'navigation' : 'dialog');
    if (wide) mega.removeAttribute('aria-modal');
    else mega.setAttribute('aria-modal', 'true');
    if (!isOpen(mega)) {
      mega.hidden = true;
      mega.setAttribute('inert', '');
    }
  }
}

export function toggleSheet(element: HTMLElement, opener: HTMLElement): void {
  if (isOpen(element)) {
    opener.setAttribute('aria-expanded', 'false');
    closeDialog(element);
    return;
  }
  opener.setAttribute('aria-expanded', 'true');
  openDialog(element, opener);
}

/** The header turns solid once the page has scrolled 24 px. */
export function watchHeader(): void {
  const header = pick<HTMLElement>('[data-part="site-header"]');
  if (!header) return;
  const apply = (): void => {
    header.classList.toggle('solid', window.scrollY > 24);
  };
  apply();
  window.addEventListener('scroll', apply, { passive: true });
}

/** The strip loops from 768 px wide and stops under reduced motion. */
export function watchStrip(): void {
  const strip = pick<HTMLElement>('[data-part="label-strip"]');
  if (!strip) return;
  const track = pick<HTMLElement>('[data-part="strip-track"]', strip);
  if (!track) return;
  const apply = (): void => {
    const loops =
      window.matchMedia(WIDE_MEGA).matches && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    track.classList.toggle('looping', loops);
  };
  apply();
  window.matchMedia(WIDE_MEGA).addEventListener('change', apply);
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', apply);
}

/** As each statement reaches the pinned fragment it moves to that statement's measure. */
export function watchPinned(move: (measure: string) => void): void {
  const pinned = pick<HTMLElement>('[data-part="pinned-strata"]');
  if (!pinned) return;
  const statements = pickAll<HTMLElement>('[data-part="pinned-statement"]', pinned);
  if (statements.length === 0) return;
  let shown = '';
  const watcher = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const measure = (entry.target as HTMLElement).getAttribute('data-measure');
        if (measure && measure !== shown) {
          shown = measure;
          move(measure);
        }
      }
    },
    { rootMargin: '-45% 0px -45% 0px' },
  );
  for (const statement of statements) watcher.observe(statement);
}
