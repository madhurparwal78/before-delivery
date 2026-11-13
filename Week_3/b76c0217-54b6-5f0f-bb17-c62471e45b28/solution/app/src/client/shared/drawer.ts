import { timers } from '../../shared/rules';
import { focusables, reducedMotion, trapTab } from './dom';
import { tween, type Tween } from './tween';

export interface Drawer {
  open(): void;
  close(): void;
  /** Return the panel to an ordinary pane (the viewport grew past the drawer widths). */
  dispose(): void;
}

/**
 * A panel that slides in from the left. `data-motion` reads opening, open, closing, closed; toggling mid-motion
 * reverses from the current position and takes as long as the distance already travelled; reduced motion is instant.
 */
export function createDrawer(options: { panel: HTMLElement; backdrop: HTMLElement; opener: HTMLElement; label: string; onChange?: (open: boolean) => void }): Drawer {
  const { panel, backdrop, opener } = options;
  let position = 0; // 0 closed, 1 open
  let running: Tween | null = null;
  let returnTo: HTMLElement = opener;

  const paint = (): void => {
    panel.style.transform = position === 1 ? 'none' : `translateX(${(position - 1) * 100}%)`;
    backdrop.style.opacity = String(position);
  };
  const keydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else {
      trapTab(event, panel);
    }
  };
  const settle = (open: boolean): void => {
    position = open ? 1 : 0;
    panel.dataset.motion = open ? 'open' : 'closed';
    paint();
    if (!open) {
      panel.hidden = true;
      panel.inert = true;
      backdrop.hidden = true;
    }
  };
  const go = (target: 0 | 1): void => {
    running?.cancel();
    const open = target === 1;
    panel.hidden = false;
    panel.inert = false;
    backdrop.hidden = false;
    opener.setAttribute('aria-expanded', String(open));
    options.onChange?.(open);
    if (reducedMotion()) {
      settle(open);
      return;
    }
    panel.dataset.motion = open ? 'opening' : 'closing';
    const from = position;
    running = tween(
      timers.drawer * Math.abs(target - from),
      (eased) => {
        position = from + (target - from) * eased;
        paint();
      },
      () => settle(open),
    );
  };

  function open(): void {
    if (panel.dataset.motion === 'open' || panel.dataset.motion === 'opening') {
      return;
    }
    returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : opener;
    go(1);
    (focusables(panel)[0] ?? panel).focus();
  }
  function close(): void {
    if (panel.dataset.motion === 'closed' || panel.dataset.motion === 'closing') {
      return;
    }
    go(0);
    returnTo.focus();
  }

  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', options.label);
  panel.tabIndex = -1;
  panel.addEventListener('keydown', keydown);
  const onBackdrop = (): void => close();
  backdrop.addEventListener('click', onBackdrop);
  settle(false);
  opener.setAttribute('aria-expanded', 'false');

  return {
    open,
    close,
    dispose: () => {
      running?.cancel();
      panel.removeEventListener('keydown', keydown);
      backdrop.removeEventListener('click', onBackdrop);
      for (const name of ['role', 'aria-modal', 'aria-label', 'data-motion', 'tabindex']) {
        panel.removeAttribute(name);
      }
      panel.hidden = false;
      panel.inert = false;
      panel.style.transform = '';
      backdrop.hidden = true;
      backdrop.style.opacity = '';
    },
  };
}
