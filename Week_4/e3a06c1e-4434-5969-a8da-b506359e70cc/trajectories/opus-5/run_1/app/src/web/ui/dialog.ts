import { el, focusables } from '../dom.js';

export interface DialogHandle {
  readonly node: HTMLElement;
  readonly body: HTMLElement;
  close(): void;
}

const inertSiblings = (overlay: HTMLElement, inert: boolean): void => {
  const root = document.getElementById('app');
  if (root === null) return;
  for (const child of [...root.children]) {
    if (child === overlay) continue;
    if (inert) child.setAttribute('inert', '');
    else child.removeAttribute('inert');
  }
};

/**
 * Opens a modal dialog. It is built on open and removed on close, so a closed
 * dialog's controls can't take focus, receive clicks or appear in the tree.
 */
export const openDialog = (
  name: string,
  build: (handle: DialogHandle) => void,
  options: { readonly sheet?: boolean; readonly onClose?: () => void } = {},
): DialogHandle => {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const body = el('div', { class: 'dialog-body' });
  const node = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': name, class: 'dialog' }, [body]);
  const overlay = el('div', { class: `dialog-overlay${options.sheet === true ? ' dialog-overlay-sheet' : ''}` }, [
    node,
  ]);

  let closed = false;
  const handle: DialogHandle = {
    node,
    body,
    close: () => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKeydown, true);
      inertSiblings(overlay, false);
      overlay.remove();
      options.onClose?.();
      if (opener !== null && opener.isConnected) opener.focus();
    },
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (!overlay.isConnected) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      handle.close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusables(node);
    if (items.length === 0) return;
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  build(handle);
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) handle.close();
  });
  document.addEventListener('keydown', onKeydown, true);
  const root = document.getElementById('app');
  root?.append(overlay);
  inertSiblings(overlay, true);
  requestAnimationFrame(() => overlay.classList.add('dialog-open'));
  const items = focusables(node);
  (items[0] ?? node).focus();
  return handle;
};
