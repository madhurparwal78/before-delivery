import { focusables, reducedMotion, setMotion, trapFocus, tween, type Tween } from './dom';

export const DRAWER_TIMER = 200;

export interface DrawerOptions {
  panel: HTMLElement;
  button: HTMLButtonElement;
  label: string;
}

export interface Drawer {
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
}

/**
 * The sidebar doubles as the modal drawer below 768 pixels: it slides from the left,
 * reverses mid-motion over the distance already travelled, and is instant under
 * reduced motion (DP-37).
 */
export function createDrawer(options: DrawerOptions): Drawer {
  const { panel, button, label } = options;
  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';
  backdrop.hidden = true;
  document.body.appendChild(backdrop);

  let offset = 1;
  let animation: Tween | null = null;
  let release: (() => void) | null = null;
  let open = false;

  setMotion(panel, 'closed');

  const render = (): void => {
    panel.style.transform = `translateX(${-100 * offset}%)`;
  };

  const run = (to: number, onDone: () => void): void => {
    animation?.cancel();
    const from = offset;
    const distance = Math.abs(to - from);
    animation = tween(
      DRAWER_TIMER * distance,
      (eased) => {
        offset = from + (to - from) * eased;
        render();
      },
      () => {
        offset = to;
        render();
        onDone();
      },
    );
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') drawer.close();
  };

  const onLinkClick = (event: MouseEvent): void => {
    if ((event.target as HTMLElement).closest('a') !== null) drawer.close();
  };

  const drawer: Drawer = {
    isOpen: () => open,
    open: () => {
      open = true;
      panel.classList.add('drawer');
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.setAttribute('aria-label', label);
      panel.removeAttribute('aria-hidden');
      backdrop.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      render();
      setMotion(panel, 'opening');
      run(0, () => setMotion(panel, 'open'));
      release?.();
      release = trapFocus(panel);
      panel.addEventListener('keydown', onKeyDown);
      panel.addEventListener('click', onLinkClick);
      (focusables(panel)[0] ?? panel).focus();
    },
    close: () => {
      if (!open) return;
      open = false;
      button.setAttribute('aria-expanded', 'false');
      setMotion(panel, 'closing');
      run(1, () => {
        setMotion(panel, 'closed');
        panel.classList.remove('drawer');
        panel.removeAttribute('role');
        panel.removeAttribute('aria-modal');
        panel.removeAttribute('aria-label');
        panel.style.transform = '';
        backdrop.hidden = true;
      });
      release?.();
      release = null;
      panel.removeEventListener('keydown', onKeyDown);
      panel.removeEventListener('click', onLinkClick);
      button.focus();
    },
  };

  button.addEventListener('click', () => {
    if (open) drawer.close();
    else drawer.open();
  });
  backdrop.addEventListener('click', () => drawer.close());
  if (reducedMotion()) panel.style.transform = '';
  return drawer;
}
