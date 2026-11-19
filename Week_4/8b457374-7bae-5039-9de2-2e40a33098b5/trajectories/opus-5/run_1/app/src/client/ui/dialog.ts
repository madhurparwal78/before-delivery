import { el } from '../dom.js';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface DialogOptions {
  /** The dialog's accessible name. */
  readonly name: string;
  readonly body: HTMLElement;
  /** Resolved when the dialog opens. */
  readonly initialFocus: () => HTMLElement | null;
  /** Resolved when the dialog closes, so a replaced opener can take focus instead. */
  readonly returnFocus: () => HTMLElement | null;
}

export interface DialogHandle {
  readonly close: () => void;
  readonly closed: () => boolean;
}

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (node) => node.offsetParent !== null || node === document.activeElement,
  );
}

/** Every dialog keeps Tab and Shift+Tab inside it, wrapping at both ends, and closes on Escape. */
export function openDialog(options: DialogOptions): DialogHandle {
  const panel = el(
    'div',
    {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': options.name,
      class: 'dialog-panel',
    },
    options.body,
  );
  const backdrop = el('div', { class: 'dialog-backdrop' }, panel);
  let open = true;

  const close = (): void => {
    if (!open) return;
    open = false;
    document.removeEventListener('keydown', onKeyDown, true);
    backdrop.remove();
    options.returnFocus()?.focus();
  };

  function onKeyDown(event: KeyboardEvent): void {
    if (!panel.isConnected) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const stops = focusables(panel);
    if (stops.length === 0) {
      event.preventDefault();
      return;
    }
    const first = stops[0] as HTMLElement;
    const last = stops[stops.length - 1] as HTMLElement;
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey && (active === first || !panel.contains(active))) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && (active === last || !panel.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener('keydown', onKeyDown, true);
  document.body.appendChild(backdrop);
  options.initialFocus()?.focus();

  return { close, closed: () => !open };
}
