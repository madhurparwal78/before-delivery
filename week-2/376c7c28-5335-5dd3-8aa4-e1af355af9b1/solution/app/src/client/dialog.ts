import { append, el } from './dom.ts';
import { fadeAway } from './motion.ts';
import type { Child } from './dom.ts';

interface DialogHandle {
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

  // Where the dialog stood as it began to close, for its fade-out.
  let leftFrom: DOMRect | null = null;
  const remember = (): void => {
    leftFrom = dialog.getBoundingClientRect();
  };
  dialog.addEventListener('cancel', remember);

  const handle: DialogHandle = {
    element: dialog,
    close: () => {
      if (!dialog.open) return;
      remember();
      dialog.close();
    },
  };
  dialog.addEventListener('close', () => {
    // The browser may already have returned focus, and the person may have moved on since.
    const focusElsewhere =
      document.activeElement !== null &&
      document.activeElement !== document.body &&
      !dialog.contains(document.activeElement);
    fadeAway(dialog, leftFrom);
    dialog.remove();
    options.onClose?.();
    if (focusElsewhere) return;
    const opener = options.opener;
    if (opener?.isConnected) opener.focus();
    else options.focusFallback?.()?.focus();
  });
  dialog.showModal();
  return handle;
}
