import { el, focusables, reducedMotion } from '../dom.js';

export interface DialogOptions {
  name: string;
  opener: HTMLElement | null;
  bottomSheet?: boolean;
  onClose?: () => void;
}

export interface DialogHandle {
  root: HTMLElement;
  close: (focusTarget?: HTMLElement | null) => void;
  body: HTMLElement;
}

let layer: HTMLElement | null = null;

function dialogLayer(): HTMLElement {
  if (layer === null || !layer.isConnected) {
    layer = el('div', { class: 'dialog-layer' });
    document.body.append(layer);
  }
  return layer;
}

export function openDialog(options: DialogOptions): DialogHandle {
  const body = el('div', { class: 'dialog-body' });
  const root = el(
    'div',
    {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': options.name,
      class: options.bottomSheet === true ? 'dialog bottom-sheet' : 'dialog',
      'data-sheet': options.bottomSheet === true ? 'bottom' : null,
    },
    [el('h2', { class: 'dialog-title', text: options.name }), body],
  );
  const backdrop = el('div', { class: 'dialog-backdrop' }, [root]);
  dialogLayer().append(backdrop);

  let closed = false;
  const close = (focusTarget?: HTMLElement | null): void => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    options.onClose?.();
    const target = focusTarget === undefined ? options.opener : focusTarget;
    if (target !== null && target !== undefined && target.isConnected) target.focus();
  };

  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusables(root);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    }
  });

  if (options.bottomSheet === true && !reducedMotion()) {
    root.animate(
      [
        { transform: 'translateY(100%)' },
        { transform: 'translateY(0)' },
      ],
      { duration: 240, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)', id: 'sheet-open' },
    );
  }

  return { root, body, close };
}

export function focusFirst(handle: DialogHandle): void {
  const items = focusables(handle.root);
  if (items.length > 0) items[0].focus();
}
