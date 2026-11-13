import { el, trapFocus } from './dom.js';
import { setDialogOpen } from './field.js';

export interface DialogHandle {
  element: HTMLElement;
  close: () => void;
}

interface DialogSpec {
  name: string;
  text: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Focus starts on the cancel button unless this says otherwise. */
  focus?: 'confirm' | 'cancel';
  onConfirm: () => void;
  opener: HTMLElement | null;
}

/**
 * One dialog at a time, with focus kept inside it. Pressing the opener again
 * during a dialog's exit leaves the newly opened dialog open.
 */
export function openDialog(spec: DialogSpec): DialogHandle {
  const confirm = el('button', {
    class: 'button',
    text: spec.confirmLabel,
    attrs: { type: 'button' },
  });
  const cancel = el('button', {
    class: 'button',
    text: spec.cancelLabel,
    attrs: { type: 'button' },
  });
  const element = el(
    'div',
    {
      class: 'dialog',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': spec.name },
    },
    [
      el('p', { class: 'dialog-text', text: spec.text }),
      el('div', { class: 'dialog-actions' }, [confirm, cancel]),
    ],
  );
  const backdrop = el('div', { class: 'dialog-backdrop' }, [element]);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    setDialogOpen(false);
    backdrop.classList.add('leaving');
    backdrop.remove();
    spec.opener?.focus();
  };

  confirm.addEventListener('click', () => {
    close();
    spec.onConfirm();
  });
  cancel.addEventListener('click', close);
  element.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    trapFocus(element, event);
  });

  document.body.append(backdrop);
  setDialogOpen(true);
  (spec.focus === 'confirm' ? confirm : cancel).focus();
  return { element: backdrop, close };
}
