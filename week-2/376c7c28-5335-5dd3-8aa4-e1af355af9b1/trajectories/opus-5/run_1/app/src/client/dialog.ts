import { append, el } from './dom.ts';
import type { Child } from './dom.ts';

export interface DialogHandle {
  readonly element: HTMLDialogElement;
  close(): void;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [role="listbox"], [role="radiogroup"]';

/** Every dialog in the app behaves the same: focus stays inside, Escape closes, focus returns. */
export function openDialog(options: {
  label: string;
  opener: HTMLElement | null;
  children: Child[];
  /** Used when the opening control is gone, as a placed piece's Move button can be. */
  focusFallback?: () => HTMLElement | null;
  onClose?: () => void;
}): DialogHandle {
  const dialog = el('dialog', { 'aria-label': options.label, class: 'panel dialog' });
  append(dialog, options.children);
  document.body.appendChild(dialog);

  const focusables = (): HTMLElement[] =>
    Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (node) => node.offsetParent !== null || node === document.activeElement,
    );

  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const items = focusables();
    if (items.length === 0) return;
    const firstItem = items[0] as HTMLElement;
    const lastItem = items[items.length - 1] as HTMLElement;
    if (event.shiftKey && document.activeElement === firstItem) {
      event.preventDefault();
      lastItem.focus();
    } else if (!event.shiftKey && document.activeElement === lastItem) {
      event.preventDefault();
      firstItem.focus();
    }
  });

  const handle: DialogHandle = {
    element: dialog,
    close: () => {
      if (!dialog.open) return;
      dialog.close();
    },
  };
  dialog.addEventListener('close', () => {
    dialog.remove();
    options.onClose?.();
    const opener = options.opener;
    if (opener?.isConnected) opener.focus();
    else options.focusFallback?.()?.focus();
  });
  dialog.showModal();
  return handle;
}
