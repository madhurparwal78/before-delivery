// Native <dialog> with the keyboard contract of DP-56: focus wraps, Escape closes, focus returns.
import { h, uid } from './dom.js';

const FOCUSABLE = 'button, input, select, textarea, a[href], summary, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

function focusables(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter((element) =>
    !element.disabled && !element.hidden && !element.closest('[hidden], [inert]')
    && !(element.type === 'hidden') && element.getClientRects().length > 0);
}

// createDialog({name, title}) -> {dialog, body, actions, open(opener), close()}
// `name` is the accessible name of the dialog; `title` the visible heading (defaults to name).
export function createDialog({ name, title = name, wide = false, sheet = false, onClose } = {}) {
  const titleId = uid('dialog-title');
  const body = h('div', { class: 'dialog-body' });
  const actions = h('div', { class: 'dialog-actions' });
  const dialog = h('dialog', {
    class: `dialog${wide ? ' dialog--wide' : ''}${sheet ? ' dialog--sheet' : ''}`,
    'aria-labelledby': titleId,
  },
  h('div', { class: 'dialog-head' }, h('h2', { id: titleId }, title)));
  dialog.append(body, actions);
  let opener = null;

  const api = {
    dialog, body, actions,
    open(from = document.activeElement) {
      opener = from;
      if (!dialog.isConnected) document.body.append(dialog);
      if (!dialog.open) dialog.showModal();
      const first = dialog.querySelector('[autofocus]') || focusables(body)[0] || focusables(actions)[0];
      (first || dialog).focus();
    },
    close() {
      if (!dialog.open) return;
      dialog.close();
      dialog.remove();
      if (opener && opener.isConnected) opener.focus();
      if (onClose) onClose();
    },
  };

  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); api.close(); return; }
    if (event.key !== 'Tab') return;
    const items = focusables(dialog);
    if (!items.length) { event.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
      event.preventDefault(); first.focus();
    }
  });
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); api.close(); });
  return api;
}

