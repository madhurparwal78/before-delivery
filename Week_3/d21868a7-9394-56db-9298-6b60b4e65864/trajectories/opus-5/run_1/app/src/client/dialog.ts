import { el, trapFocus } from './dom.ts';

/**
 * A dialog that keeps its newest state: reopening it while it is still leaving
 * after Escape or Cancel leaves it open, with its typed values untouched.
 */

export interface DialogOptions {
  role: 'dialog' | 'alertdialog';
  label: string;
  className?: string;
  onEscape: () => void;
}

export interface ManagedDialog {
  element: HTMLElement;
  overlay: HTMLElement;
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
  destroy: () => void;
}

const EXIT_MS = 160;

export function managedDialog(host: HTMLElement, options: DialogOptions): ManagedDialog {
  const element = el('div', {
    class: `dialog ${options.className ?? ''}`.trim(),
    attrs: { role: options.role, 'aria-modal': 'true', 'aria-label': options.label },
  });
  const overlay = el('div', { class: 'overlay', children: [element] });
  const release = trapFocus(element, () => options.onEscape());
  let open = false;
  let timer = 0;

  return {
    element,
    overlay,
    isOpen: () => open,
    open: () => {
      window.clearTimeout(timer);
      overlay.classList.remove('leaving');
      if (!host.contains(overlay)) host.appendChild(overlay);
      open = true;
    },
    close: () => {
      if (!open) return;
      open = false;
      overlay.classList.add('leaving');
      timer = window.setTimeout(() => {
        if (!open) overlay.remove();
      }, EXIT_MS);
    },
    destroy: () => {
      release();
      window.clearTimeout(timer);
      overlay.remove();
    },
  };
}
