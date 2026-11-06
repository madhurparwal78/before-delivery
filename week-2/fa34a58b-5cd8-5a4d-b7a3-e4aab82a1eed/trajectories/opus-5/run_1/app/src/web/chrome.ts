import { focusableIn, isWideViewport, must, prefersReducedMotion } from './dom';

/**
 * The rail is a fixed column at 1280x800 and a drawer below it. The drawer
 * carries the dialog role only while it is the drawer.
 */
export function installRail(): void {
  const rail = must<HTMLElement>('[data-rail]');
  const menuButton = must<HTMLButtonElement>('[data-menu-button]');
  const closeButton = must<HTMLButtonElement>('[data-rail-close]');

  const applyMode = (): void => {
    if (isWideViewport()) {
      rail.removeAttribute('role');
      rail.removeAttribute('aria-modal');
      rail.removeAttribute('aria-label');
      rail.removeAttribute('data-open');
    } else {
      rail.setAttribute('role', 'dialog');
      rail.setAttribute('aria-modal', 'true');
      rail.setAttribute('aria-label', 'Menu');
    }
  };

  const open = (): void => {
    rail.setAttribute('data-open', '');
    const items = focusableIn(rail);
    (items[0] ?? rail).focus();
  };

  const close = (): void => {
    if (!rail.hasAttribute('data-open')) return;
    rail.removeAttribute('data-open');
    menuButton.focus();
  };

  menuButton.addEventListener('click', open);
  closeButton.addEventListener('click', close);
  rail.addEventListener('keydown', (event) => {
    if (isWideViewport()) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusableIn(rail);
    if (items.length === 0) return;
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  applyMode();
  window.addEventListener('resize', () => {
    applyMode();
    if (isWideViewport()) rail.removeAttribute('data-open');
  });
}

export function installMotionFlag(): void {
  document.documentElement.dataset['reducedMotion'] = prefersReducedMotion() ? 'on' : 'off';
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => {
    document.documentElement.dataset['reducedMotion'] = prefersReducedMotion() ? 'on' : 'off';
  });
}
