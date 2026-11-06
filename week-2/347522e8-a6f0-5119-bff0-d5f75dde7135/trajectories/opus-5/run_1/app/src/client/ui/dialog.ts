/**
 * Dialogs. Every one starts on its first field or primary button, wraps focus
 * explicitly, closes on Escape and returns focus to the control that opened it
 * unless the caller names another target.
 */

import { el, focusables, trapFocus } from '../dom.js';

export interface DialogHandle {
  element: HTMLElement;
  close(options?: { focus?: HTMLElement | null }): void;
  isOpen(): boolean;
}

export interface DialogOptions {
  role?: 'dialog' | 'alertdialog';
  label: string;
  opener: HTMLElement | null;
  body: readonly (Node | string)[];
  onClose?: () => void;
}

export function openDialog(options: DialogOptions): DialogHandle {
  const panel = el('div', {
    class: 'dialog',
    attrs: {
      role: options.role ?? 'dialog',
      'aria-modal': 'true',
      'aria-label': options.label,
      tabindex: '-1',
    },
  });
  panel.append(...options.body);
  const scrim = el('div', { class: 'scrim' }, [panel]);

  let open = true;
  const trap = trapFocus(panel);

  const close = (closeOptions: { focus?: HTMLElement | null } = {}): void => {
    if (!open) return;
    open = false;
    scrim.remove();
    document.removeEventListener('keydown', onKeyDown, true);
    options.onClose?.();
    const target =
      closeOptions.focus === undefined ? options.opener : closeOptions.focus;
    target?.focus();
  };

  function onKeyDown(event: KeyboardEvent): void {
    if (!open || !scrim.isConnected) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    trap(event);
  }

  document.addEventListener('keydown', onKeyDown, true);
  document.body.append(scrim);

  const first = focusables(panel)[0];
  (first ?? panel).focus();

  return { element: panel, close, isOpen: () => open };
}
