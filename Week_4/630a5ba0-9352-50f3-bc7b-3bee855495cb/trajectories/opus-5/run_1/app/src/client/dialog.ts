import { el } from './dom.js';

export interface DialogHandle {
  element: HTMLDialogElement;
  close: () => void;
  body: HTMLElement;
}

/**
 * Opens a modal dialog, moves focus to its first field, keeps Tab inside it and returns
 * focus to the control that opened it.
 */
export function openDialog(options: {
  label: string;
  role?: 'dialog' | 'alertdialog';
  heading?: string;
  content: (HTMLElement | null)[];
  actions: HTMLElement[];
  opener: HTMLElement | null;
}): DialogHandle {
  const body = el('div', {}, options.content.filter((node): node is HTMLElement => node !== null));
  const dialog = el('dialog', {
    'aria-label': options.label,
    role: options.role === 'alertdialog' ? 'alertdialog' : null,
  }) as HTMLDialogElement;
  if (options.heading) dialog.append(el('h2', { text: options.heading }));
  dialog.append(body, el('div', { class: 'dialog-actions' }, options.actions));
  document.body.append(dialog);

  const close = (): void => {
    if (dialog.open) dialog.close();
  };
  const openerKey = options.opener?.dataset.focusKey;
  dialog.addEventListener('close', () => {
    dialog.remove();
    returnFocus(options.opener, openerKey);
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (node) => !node.hasAttribute('disabled'),
    );
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  dialog.showModal();
  const firstField = dialog.querySelector<HTMLElement>(FOCUSABLE);
  firstField?.focus();
  return { element: dialog, close, body };
}

const FOCUSABLE =
  'input:not([type="hidden"]), select, textarea, button, a[href], [tabindex]:not([tabindex="-1"])';

/** The page may have re-rendered while the dialog was open, so prefer the opener's key. */
function returnFocus(opener: HTMLElement | null, key: string | undefined): void {
  if (key !== undefined) {
    const fresh = document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`);
    if (fresh) {
      fresh.focus();
      return;
    }
  }
  if (opener?.isConnected) opener.focus();
}
