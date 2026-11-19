import { el } from './dom.js';

export interface DialogOptions {
  title: string;
  body?: string | HTMLElement;
  alert?: boolean;
  dim?: boolean;
  fade?: boolean;
  actions?: { label: string; primary?: boolean; danger?: boolean; onClick: (close: () => void) => void }[];
  form?: HTMLElement;
  onOpen?: (dialog: HTMLElement, close: () => void) => void;
  onClose?: () => void;
}

let openDialog: { container: HTMLElement; opener: HTMLElement | null; onClose?: () => void } | null = null;

export function closeActiveDialog (): void {
  if (openDialog === null) return;
  document.body.removeChild(openDialog.container);
  const { opener, onClose } = openDialog;
  openDialog = null;
  onClose?.();
  if (opener !== null && document.contains(opener)) opener.focus();
}

export function openDialogWith (options: DialogOptions): HTMLElement {
  if (openDialog !== null) closeActiveDialog();
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const close = (): void => {
    if (openDialog !== null && openDialog.container === container) {
      closeActiveDialog();
    }
  };

  const container = el('div', { class: `dialog-backdrop${options.dim === true ? ' dim' : ''}` });
  const dialog = el('div', { class: `dialog${options.alert === true ? ' alert' : ''}`, role: options.alert === true ? 'alertdialog' : 'dialog', 'aria-label': options.title });
  dialog.append(el('h2', { text: options.title }));
  if (typeof options.body === 'string' && options.body !== '') {
    dialog.append(el('div', { class: 'dialog-body', text: options.body }));
  } else if (options.body instanceof HTMLElement) {
    const wrap = el('div', { class: 'dialog-body' });
    wrap.append(options.body);
    dialog.append(wrap);
  }
  if (options.form !== undefined) dialog.append(options.form);
  if (options.actions !== undefined && options.actions.length > 0) {
    const actions = el('div', { class: 'dialog-actions' });
    for (const action of options.actions) {
      actions.append(el('button', { class: `row-button${action.primary === true ? ' primary' : ''}${action.danger === true ? ' danger' : ''}`, text: action.label, click: () => action.onClick(close) }));
    }
    dialog.append(actions);
  }
  container.append(dialog);
  document.body.append(container);
  openDialog = { container, opener, onClose: options.onClose };

  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const focusables = dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    const list = [...focusables].filter((node) => !node.hasAttribute('disabled'));
    if (list.length === 0) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  const focusables = dialog.querySelectorAll<HTMLElement>('button, input, select, textarea');
  const first = focusables[0];
  if (first !== undefined) first.focus();
  options.onOpen?.(dialog, close);
  return dialog;
}

