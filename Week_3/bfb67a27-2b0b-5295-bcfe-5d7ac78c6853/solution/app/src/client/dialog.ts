import { clear, el, focusFirstControl, prefersReducedMotion } from './dom.js';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface OpenDialog {
  panel: HTMLElement;
  close: () => void;
}

/**
 * Opens a modal dialog, moves focus to its first control, wraps Tab inside it
 * and returns focus to the opener when it closes.
 */
export function openDialog(name: string, build: (close: () => void) => Node[]): OpenDialog {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const backdrop = el('div', { class: 'dialog-backdrop' });
  const panel = el('div', {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': name,
    class: prefersReducedMotion() ? 'dialog' : 'dialog dialog-enter',
  });

  const close = (): void => {
    backdrop.remove();
    document.removeEventListener('keydown', onKeyDown, true);
    opener?.focus();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!backdrop.isConnected) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (item) => item.offsetParent !== null || item === document.activeElement,
    );
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
  };

  clear(panel);
  for (const child of build(close)) panel.append(child);
  backdrop.append(panel);
  document.body.append(backdrop);
  document.addEventListener('keydown', onKeyDown, true);
  focusFirstControl(panel);
  return { panel, close };
}
