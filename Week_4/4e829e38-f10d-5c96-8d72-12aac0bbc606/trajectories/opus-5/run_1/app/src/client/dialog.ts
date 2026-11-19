import { el, focusable, trapFocus } from './dom.js';

export interface DialogHandle {
  root: HTMLElement;
  /** Closes and returns focus to the control that opened it. */
  close: () => void;
  /** Closes and leaves focus placement to the caller, used after a delete. */
  dismiss: () => void;
}

const openDialogs: DialogHandle[] = [];

export function openDialog(options: {
  name: string;
  opener: HTMLElement | null;
  variant?: 'modal' | 'sheet' | 'popover';
  build: (handle: DialogHandle) => Node;
  onClose?: () => void;
}): DialogHandle {
  const variant = options.variant ?? 'modal';
  const layer = el('div', { class: `dialog-layer dialog-layer--${variant}` });
  const root = el('div', {
    role: 'dialog',
    'aria-modal': variant === 'popover' ? 'false' : 'true',
    'aria-label': options.name,
    class: `dialog dialog--${variant}`,
  });
  layer.appendChild(root);

  let release: () => void = () => undefined;
  const teardown = (): boolean => {
    const index = openDialogs.indexOf(handle);
    if (index === -1) return false;
    openDialogs.splice(index, 1);
    release();
    layer.remove();
    options.onClose?.();
    return true;
  };
  const handle: DialogHandle = {
    root,
    close: () => {
      if (!teardown()) return;
      if (options.opener && options.opener.isConnected) options.opener.focus();
    },
    dismiss: () => {
      teardown();
    },
  };
  root.appendChild(options.build(handle));
  release = trapFocus(root, handle.close);
  document.body.appendChild(layer);
  openDialogs.push(handle);
  const first = focusable(root)[0];
  if (first) first.focus();
  return handle;
}

export function closeAllDialogs(): void {
  while (openDialogs.length > 0) openDialogs[openDialogs.length - 1].dismiss();
}

export function confirmDelete(options: {
  name: string;
  opener: HTMLElement | null;
  onDelete: () => void | Promise<void>;
}): DialogHandle {
  return openDialog({
    name: `Delete ${options.name}?`,
    opener: options.opener,
    build: (handle) => {
      const remove = el('button', { type: 'button', class: 'pill pill--dark' }, 'Delete');
      const cancel = el('button', { type: 'button', class: 'pill pill--ghost' }, 'Cancel');
      remove.addEventListener('click', () => {
        if (remove.getAttribute('aria-busy') === 'true') return;
        remove.setAttribute('aria-busy', 'true');
        handle.dismiss();
        void Promise.resolve(options.onDelete());
      });
      cancel.addEventListener('click', handle.close);
      return el('div', { class: 'dialog-body' }, [
        el('h2', { class: 'dialog-title' }, `Delete ${options.name}?`),
        el('p', { class: 'dialog-copy' }, 'This cannot be undone.'),
        el('div', { class: 'dialog-actions' }, [remove, cancel]),
      ]);
    },
  });
}
