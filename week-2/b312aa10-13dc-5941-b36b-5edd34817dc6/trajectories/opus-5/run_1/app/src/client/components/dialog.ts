/** A board dialog: top layer, inside the viewport, content behind inert. */
import { append, el, type Child } from '../dom.js';

export type DialogHandle = {
  element: HTMLDialogElement;
  close: () => void;
  isOpen: () => boolean;
};

export type DialogOptions = {
  label: string;
  content: Child;
  opener?: HTMLElement | null;
  firstFocus?: () => HTMLElement | null;
  onEscape?: () => void;
  onClosed?: () => void;
  className?: string;
};

export function openDialog(options: DialogOptions): DialogHandle {
  const dialog = el('dialog', {
    'aria-label': options.label,
    class: `board-dialog ${options.className ?? ''}`.trim(),
  }) as HTMLDialogElement;
  append(dialog, options.content);
  document.body.appendChild(dialog);

  let closed = false;
  const finish = (): void => {
    if (closed) return;
    closed = true;
    if (dialog.open) dialog.close();
    dialog.remove();
    options.onClosed?.();
    options.opener?.focus();
  };

  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    if (options.onEscape) options.onEscape();
    else finish();
  });

  dialog.showModal();
  const first = options.firstFocus?.() ?? dialog.querySelector<HTMLElement>(
    'input, select, textarea, button',
  );
  first?.focus();

  return {
    element: dialog,
    close: finish,
    isOpen: () => !closed,
  };
}
