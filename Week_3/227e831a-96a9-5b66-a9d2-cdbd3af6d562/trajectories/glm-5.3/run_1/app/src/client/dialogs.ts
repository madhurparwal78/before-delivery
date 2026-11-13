import { el } from './dom.js';

/**
 * Dialogs. Every dialog keeps Tab and Shift+Tab inside itself, closes on
 * Escape, and returns focus to the control that opened it — except where the
 * workspace's rules name another target.
 */

export interface DialogHandle {
  readonly element: HTMLDialogElement;
  close: (returnFocus?: boolean) => void;
  readonly opener: HTMLElement | null;
}

export function openDialog(label: string, build: (root: HTMLDialogElement) => void, opener: HTMLElement | null, options?: { returnFocus?: boolean }): DialogHandle {
  const dialog = el('dialog', { class: 'sheet', 'aria-label': label }) as HTMLDialogElement;
  const handle: DialogHandle = {
    element: dialog,
    opener,
    close: (returnFocus = true) => {
      if (dialog.open) dialog.close();
      dialog.remove();
      if (returnFocus && (options?.returnFocus ?? true)) {
        if (opener !== null && document.contains(opener)) opener.focus();
      }
    },
  };
  build(dialog);
  document.body.append(dialog);

  const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>('input, select, textarea, button, [tabindex]:not([tabindex="-1"])')).filter((node) => !node.hasAttribute('disabled') && node.offsetParent !== null);
  const first = focusables()[0] ?? dialog;
  const wrap = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      handle.close();
      return;
    }
    if (event.key !== 'Tab') return;
    const list = focusables();
    if (list.length === 0) return;
    const firstEl = list[0]!;
    const lastEl = list[list.length - 1]!;
    if (event.shiftKey && document.activeElement === firstEl) {
      event.preventDefault();
      lastEl.focus();
    } else if (!event.shiftKey && document.activeElement === lastEl) {
      event.preventDefault();
      firstEl.focus();
    }
  };
  dialog.addEventListener('keydown', wrap);
  dialog.addEventListener('close', () => {
    // Cancel through the browser chrome also returns focus.
    if (document.contains(dialog) === false) return;
  });
  dialog.showModal();
  first.focus();
  return handle;
}

/** A dialog's action row, with Cancel wired to the published behaviour. */
export function dialogActions(items: { label: string; onClick: () => void; primary?: boolean; cancel?: boolean }[]): HTMLElement {
  const row = el('div', { class: 'actions' });
  for (const item of items) {
    const button = el('button', { type: 'button' }, [item.label]);
    button.addEventListener('click', item.onClick);
    row.append(button);
  }
  return row;
}
