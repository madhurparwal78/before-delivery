// Keyboard-complete dialogs, adapted from kit/modules/a11y_dialog: a native <dialog> opened with showModal(), Tab and
// Shift+Tab wrap inside it, Escape closes it, focus returns to the control that opened it.

function isFocusable(el) {
  if (el.hasAttribute('disabled') || el.hasAttribute('hidden') || el.hasAttribute('inert')) return false;
  const tabindex = el.getAttribute('tabindex');
  if (tabindex !== null) return Number(tabindex) >= 0;
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') return el.hasAttribute('href');
  if (tag === 'input') return el.getAttribute('type') !== 'hidden';
  return ['button', 'select', 'textarea', 'summary'].includes(tag);
}

function focusables(root) {
  return [...root.querySelectorAll('*')].filter(isFocusable);
}

// openDialog shows a <dialog> element modally. `opener` is where focus returns on close (default: the element focused
// now). `onClose` runs once after it closes. Returns {close}.
export function openDialog(dialog, opener, onClose) {
  const returnTo = opener ?? document.activeElement;
  dialog.showModal();
  const items = focusables(dialog);
  const first = items.find((el) => el.hasAttribute('autofocus')) ?? items[0];
  if (first) first.focus();
  let open = true;

  const close = () => {
    if (!open) return;
    open = false;
    dialog.removeEventListener('keydown', onKey);
    dialog.removeEventListener('cancel', onCancel);
    if (dialog.open) dialog.close();
    if (returnTo && returnTo.isConnected) returnTo.focus();
    if (onClose) onClose();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      const els = focusables(dialog);
      if (!els.length) return e.preventDefault();
      const edge = e.shiftKey ? els[0] : els[els.length - 1];
      if (document.activeElement === edge || !dialog.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? els[els.length - 1] : els[0]).focus();
      }
    }
  };
  const onCancel = (e) => {
    e.preventDefault();
    close();
  };
  dialog.addEventListener('keydown', onKey);
  dialog.addEventListener('cancel', onCancel);
  return { close };
}
