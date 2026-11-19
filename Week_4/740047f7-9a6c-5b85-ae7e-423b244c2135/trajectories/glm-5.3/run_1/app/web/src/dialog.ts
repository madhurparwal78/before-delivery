// Focus-trapping dialogs: Tab stays inside, Escape closes, focus returns to the opener.

import { h } from './ui';

export interface DialogSpec {
  title: string;
  body: (root: HTMLElement) => void;
  onClose?: () => void;
  initialFocus?: 'first' | 'cancel';
}

const openStack: { dlg: HTMLDialogElement; opener: HTMLElement | null; onClose?: () => void }[] = [];

export function anyDialogOpen(): boolean {
  return openStack.length > 0;
}

export function openDialog(spec: DialogSpec, opener: HTMLElement | null): HTMLDialogElement {
  const dlg = document.createElement('dialog');
  const pad = h('div', { class: 'dialog-pad' });
  pad.append(h('div', { class: 'dialog-title', text: spec.title }));
  const body = h('div');
  pad.append(body);
  dlg.append(pad);
  document.body.append(dlg);

  const focusables = () => Array.from(dlg.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )).filter(e => !e.hasAttribute('disabled') && e.offsetParent !== null);

  spec.body(body);

  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeTopDialog();
      return;
    }
    if (e.key === 'Tab') {
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  dlg.addEventListener('close', () => {
    dlg.remove();
  });

  openStack.push({ dlg, opener, onClose: spec.onClose });
  dlg.showModal();

  // Confirm dialogs start on their cancel control; others on the first control.
  const items = focusables();
  const cancel = items.find(i => i.getAttribute('data-cancel') === 'true');
  if (spec.initialFocus === 'cancel' && cancel) {
    cancel.focus();
  } else if (items.length) {
    items[0].focus();
  }
  return dlg;
}

export function closeTopDialog(): void {
  const top = openStack.pop();
  if (!top) return;
  top.dlg.close();
  top.onClose?.();
  const opener = top.opener;
  if (opener && document.contains(opener)) {
    opener.focus();
  }
}

export function closeDialogOf(dlg: HTMLDialogElement): void {
  const idx = openStack.findIndex(o => o.dlg === dlg);
  if (idx >= 0) openStack.splice(idx, 1);
  dlg.close();
}

/** Closes every dialog belonging to this page (used when leaving a route). */
export function closeAllDialogs(): void {
  while (openStack.length) closeTopDialog();
}
