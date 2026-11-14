import { h } from './dom.ts';

// Modal dialogs on the native <dialog>: focus starts on the first control, Tab and Shift+Tab wrap, Escape closes,
// a click outside does nothing, and closing returns focus to the control that opened it.

const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.hasAttribute('disabled') && !el.hidden && el.getAttribute('aria-hidden') !== 'true' && el.getClientRects().length > 0,
  );
}

export interface OpenDialog { dialog: HTMLDialogElement; close: () => void }

/** `first` is the control that takes focus (default: the first focusable one). */
export function openDialog(dialog: HTMLDialogElement, opener: HTMLElement | null, options: { first?: HTMLElement; onClose?: () => void } = {}): OpenDialog {
  document.body.appendChild(dialog);
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    dialog.removeEventListener('keydown', onKey);
    dialog.close();
    dialog.remove();
    opener?.focus();
    options.onClose?.();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusables(dialog);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return event.preventDefault();
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };
  dialog.addEventListener('keydown', onKey);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  dialog.showModal();
  (options.first ?? focusables(dialog)[0] ?? dialog).focus();
  return { dialog, close };
}

export function dialogShell(name: string, ...content: (Node | string)[]): HTMLDialogElement {
  const heading = h('h2', { id: `dialog-${name.replace(/\W+/g, '-').toLowerCase()}`, class: 'dialog-title' }, name);
  const dialog = h('dialog', { class: 'dialog', 'aria-labelledby': heading.id }, heading, ...content);
  return dialog;
}
