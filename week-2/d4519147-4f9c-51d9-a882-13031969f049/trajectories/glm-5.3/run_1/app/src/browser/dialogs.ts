// Dialogs, sheets and drawers: focus wrapping, Escape, focus return.

import { h, focusFirst } from './hyperscript.js';

export interface DialogHandle {
  close: () => void;
  element: HTMLElement;
}

export interface DialogOptions {
  firstFocus?: () => void;
  onClose?: () => void;
  noEscape?: boolean;
}

const openDialogs: DialogHandle[] = [];

// Everything outside an open dialog is inert while it is open.
function setInertOutside(dialog: HTMLElement): void {
  for (const child of Array.from(document.body.children)) {
    if (child === dialog || dialog.contains(child) || child.hasAttribute('data-dialog-root')) {
      continue;
    }
    if (child.getAttribute('inert') === null) {
      child.setAttribute('inert', '');
      child.setAttribute('data-made-inert', 'true');
    }
  }
}

function clearInert(): void {
  for (const child of Array.from(document.body.children)) {
    if (child.getAttribute('data-made-inert') === 'true') {
      child.removeAttribute('inert');
      child.removeAttribute('data-made-inert');
    }
  }
}

export function openDialog(label: string, body: HTMLElement, options: DialogOptions): DialogHandle {
  const overlay = h('div', { class: 'dialog-overlay' });
  const dialog = h('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': label, class: 'dialog' });
  dialog.appendChild(body);
  overlay.appendChild(dialog);
  overlay.setAttribute('data-dialog-root', '');
  document.body.appendChild(overlay);

  const handle: DialogHandle = {
    element: dialog,
    close: () => {
      const index = openDialogs.indexOf(handle);
      if (index !== -1) openDialogs.splice(index, 1);
      overlay.remove();
      if (openDialogs.length === 0) {
        clearInert();
      } else if (openDialogs.length > 0) {
        void openDialogs[openDialogs.length - 1];
      }
      options.onClose?.();
    },
  };
  openDialogs.push(handle);
  setInertOutside(overlay);

  overlay.addEventListener('pointerdown', (e: MouseEvent) => {
    if (e.target === overlay && !options.noEscape) {
      handle.close();
    }
  });
  dialog.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !options.noEscape) {
      e.stopPropagation();
      handle.close();
      return;
    }
    if (e.key === 'Tab') {
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  if (options.firstFocus !== undefined) {
    options.firstFocus();
  } else {
    focusFirst(dialog);
  }
  return handle;
}

