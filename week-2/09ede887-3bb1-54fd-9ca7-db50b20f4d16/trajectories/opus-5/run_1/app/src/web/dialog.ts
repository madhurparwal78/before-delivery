import { el } from './dom.js';

export interface DialogHandle {
  close: () => void;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Opens a modal dialog that traps Tab, answers Escape and returns focus. */
export function openDialog(
  panel: HTMLElement,
  initialFocus: HTMLElement,
  opener: HTMLElement | null,
  onClose: () => void,
): DialogHandle {
  const backdrop = el('div', { class: 'dialog-backdrop' }, [panel]);
  document.body.appendChild(backdrop);
  document.body.classList.add('dialog-open');
  requestAnimationFrame(() => backdrop.classList.add('dialog-shown'));
  initialFocus.focus();

  const close = (): void => {
    document.removeEventListener('keydown', onKeyDown, true);
    backdrop.remove();
    document.body.classList.remove('dialog-open');
    onClose();
    opener?.focus();
  };

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const stops = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (node) => node.offsetParent !== null || node === initialFocus,
    );
    if (stops.length === 0) return;
    const first = stops[0] as HTMLElement;
    const last = stops[stops.length - 1] as HTMLElement;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  document.addEventListener('keydown', onKeyDown, true);
  return { close };
}
