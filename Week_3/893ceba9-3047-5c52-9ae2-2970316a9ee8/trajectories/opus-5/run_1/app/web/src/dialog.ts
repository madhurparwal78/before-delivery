// One dialog behaviour for every dialog: focus on the first field, Tab wraps,
// Escape closes, and focus returns to the control that opened it.

import { el } from './dom';

export type DialogHandle = {
  root: HTMLElement;
  panel: HTMLElement;
  close: () => void;
};

export function openModal(options: {
  name: string;
  opener: HTMLElement | null;
  body: (handle: DialogHandle) => (Node | string)[];
  fullHeight?: boolean;
}): DialogHandle {
  const panel = el('div', {
    class: `dialog-panel ${options.fullHeight ? 'full-height' : ''}`.trim(),
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': options.name,
  });
  const root = el('div', { class: 'dialog-scrim' }, [panel]);

  const handle: DialogHandle = {
    root,
    panel,
    close: () => {
      root.remove();
      document.removeEventListener('keydown', onKey, true);
      options.opener?.focus();
    },
  };

  function focusables(): HTMLElement[] {
    return Array.from(
      panel.querySelectorAll<HTMLElement>(
        'input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((node) => node.offsetParent !== null || node === document.activeElement);
  }

  function onKey(event: KeyboardEvent): void {
    if (!root.isConnected) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      handle.close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusables();
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  panel.append(...options.body(handle));
  document.body.append(root);
  document.addEventListener('keydown', onKey, true);

  const items = focusables();
  const field = items.find((node) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName));
  (field ?? items[0])?.focus();
  return handle;
}

// labelledField builds a labelled control that can show a field error.
export function labelledField(
  label: string,
  control: HTMLElement,
): HTMLElement {
  const id = `field-${Math.random().toString(36).slice(2, 10)}`;
  control.setAttribute('id', id);
  control.setAttribute('data-field', control.getAttribute('data-field') ?? label.toLowerCase());
  return el('div', { class: 'field' }, [el('label', { for: id, text: label }), control]);
}
