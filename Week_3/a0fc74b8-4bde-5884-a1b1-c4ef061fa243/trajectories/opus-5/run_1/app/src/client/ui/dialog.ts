import { focusableIn, h } from '../dom.ts';

export interface DialogHandle {
  root: HTMLElement;
  body: HTMLElement;
  close: () => void;
}

/**
 * Tab and Shift+Tab cycle inside the dialog and never reach the page behind it.
 * Escape closes it and focus returns to the control that opened it.
 */
export const openDialog = (
  label: string,
  build: (handle: DialogHandle) => void,
  opener: HTMLElement | null,
  options: { className?: string; onClose?: () => void } = {},
): DialogHandle => {
  const body = h('div', { class: 'dialog-body' });
  const root = h(
    'div',
    {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': label,
      class: `dialog ${options.className ?? ''}`.trim(),
    },
    body,
  );
  const backdrop = h('div', { class: 'dialog-backdrop' }, root);
  let closed = false;

  const close = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeyDown, true);
    backdrop.remove();
    options.onClose?.();
    opener?.focus();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (closed) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = focusableIn(root);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !root.contains(active))) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handle: DialogHandle = { root, body, close };
  build(handle);
  document.body.appendChild(backdrop);
  document.addEventListener('keydown', onKeyDown, true);
  const focusable = focusableIn(root);
  (focusable[0] ?? root).focus();
  return handle;
};
