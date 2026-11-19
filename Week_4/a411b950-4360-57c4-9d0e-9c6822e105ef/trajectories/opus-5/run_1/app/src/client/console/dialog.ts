import { el, focusableChildren, trapFocus } from '../shared/dom.ts';

export type Dialog = {
  element: HTMLElement;
  close: () => void;
};

export function openDialog(options: {
  label: string;
  role?: 'dialog' | 'alertdialog';
  body: Array<Node | null>;
  opener: HTMLElement;
}): Dialog {
  const dialog = el(
    'div',
    { class: 'console-dialog', role: options.role ?? 'dialog', 'aria-modal': 'true', 'aria-label': options.label },
    options.body,
  );
  const backdrop = el('div', { class: 'dialog-backdrop' }, [dialog]);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    release();
    backdrop.remove();
    options.opener.focus();
  };
  const release = trapFocus(dialog, close);
  document.body.append(backdrop);
  const focusable = focusableChildren(dialog);
  (focusable[0] ?? dialog).focus();
  return { element: dialog, close };
}
