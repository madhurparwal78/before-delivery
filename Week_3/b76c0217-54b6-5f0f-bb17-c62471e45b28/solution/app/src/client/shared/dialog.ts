// Adapted from kit/modules/a11y_dialog: a native modal <dialog> with Tab kept inside, Escape to close and focus
// returned to whatever had it when the dialog opened.

import { trapTab } from './dom';

export interface OpenDialog {
  close(): void;
}

export function openDialog(dialog: HTMLDialogElement, options: { returnTo?: HTMLElement | null; onClose?: () => void; focus?: HTMLElement | null } = {}): OpenDialog {
  const returnTo = options.returnTo ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  let isOpen = true;
  const keydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else {
      trapTab(event, dialog);
    }
  };
  function close(): void {
    if (!isOpen) {
      return;
    }
    isOpen = false;
    dialog.removeEventListener('keydown', keydown);
    dialog.removeEventListener('cancel', onCancel);
    dialog.close();
    if (returnTo?.isConnected) {
      returnTo.focus();
    }
    options.onClose?.();
  }
  function onCancel(event: Event): void {
    event.preventDefault();
    close();
  }
  dialog.addEventListener('keydown', keydown);
  dialog.addEventListener('cancel', onCancel);
  if (!dialog.open) {
    dialog.showModal();
  }
  const first = options.focus ?? dialog.querySelector<HTMLElement>('[autofocus]') ?? dialog.querySelector<HTMLElement>('button, input, select, textarea, a[href]');
  (first ?? dialog).focus();
  return { close };
}
