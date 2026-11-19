import { need, query, queryAll } from './dom.js';
import { focusWithout, jumpToHeading, jumpToSection } from './focus.js';
import { EASE_OUT, reduced } from './motion.js';
import { writeHash } from './params.js';

const MENU_MS = 260;
const MENU_WIDTH = 1024;

let menuOpen = false;

const dialog = (): HTMLDialogElement => need<HTMLDialogElement>('[data-menu]');
const openButton = (): HTMLElement => need<HTMLElement>('[data-menu-open]');

export function openMenu(): void {
  const element = dialog();
  element.showModal();
  menuOpen = true;
  const panel = need<HTMLElement>('[data-menu-panel]', element);
  if (!reduced()) {
    panel.animate(
      [{ transform: 'translateY(-100%)' }, { transform: 'translateY(0)' }],
      { duration: MENU_MS, easing: EASE_OUT },
    );
  }
  focusWithout(need<HTMLElement>('a[data-nav]', element));
  updateCurrentLinks(lastSection);
}

/**
 * Closes the menu and settles once the panel has slid away. Focus only moves
 * out of the dialog when it is closed, so callers wait for this promise.
 */
export function closeMenu(): Promise<void> {
  if (!menuOpen) return Promise.resolve();
  const element = dialog();
  const panel = need<HTMLElement>('[data-menu-panel]', element);
  menuOpen = false;
  const finish = (): void => {
    element.close();
    updateCurrentLinks(lastSection);
  };
  if (reduced()) {
    finish();
    return Promise.resolve();
  }
  const animation = panel.animate(
    [{ transform: 'translateY(0)' }, { transform: 'translateY(-100%)' }],
    { duration: MENU_MS, easing: EASE_OUT },
  );
  return animation.finished.then(finish, finish);
}

let lastSection: string | null = null;

export function updateCurrentLinks(section: string | null): void {
  lastSection = section;
  for (const link of queryAll<HTMLElement>('a[data-nav]')) {
    const inMenu = link.closest('[data-menu]') !== null;
    const live = inMenu ? menuOpen : window.innerWidth >= MENU_WIDTH;
    if (live && section !== null && link.dataset.nav === section) {
      link.setAttribute('aria-current', 'true');
    } else {
      link.removeAttribute('aria-current');
    }
  }
}

export function initChrome(): void {
  const skip = need<HTMLAnchorElement>('[data-skip]');
  skip.addEventListener('click', (event) => {
    const heading = query<HTMLElement>(skip.hash);
    if (!heading) return;
    event.preventDefault();
    jumpToHeading(heading);
  });

  openButton().addEventListener('click', () => openMenu());

  const element = dialog();
  const dismiss = (): void => {
    void closeMenu().then(() => focusWithout(openButton()));
  };
  need<HTMLElement>('[data-menu-close]', element).addEventListener('click', dismiss);
  element.addEventListener('cancel', (event) => {
    event.preventDefault();
    dismiss();
  });
  element.addEventListener('click', (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest('[data-menu-panel]') === null) dismiss();
  });
  for (const link of queryAll<HTMLAnchorElement>('a[data-nav]', element)) {
    link.addEventListener('click', (event) => {
      const section = link.dataset.nav!;
      if (query(`#${section}-heading`) === null) {
        void closeMenu();
        return;
      }
      event.preventDefault();
      void closeMenu().then(() => {
        writeHash(`#${section}`);
        jumpToSection(section);
      });
    });
  }

  window.addEventListener('resize', () => updateCurrentLinks(lastSection));
}
