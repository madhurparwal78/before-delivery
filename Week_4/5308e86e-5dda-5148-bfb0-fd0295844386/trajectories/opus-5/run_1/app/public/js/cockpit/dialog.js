// A dialog keeps Tab inside itself, closes on Escape and returns focus to its
// opener. A closed dialog is gone from the page.

import { el, trapTab } from '../dom.js';

let openCount = 0;

export function dialogIsOpen() {
  return openCount > 0;
}

export function openDialog({ label, content, initialFocus, onClose }) {
  const opener = document.activeElement;
  const panel = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': label });
  const scrim = el('div', { class: 'dialog-scrim' }, [panel]);
  panel.append(content);

  let closed = false;
  function close({ restoreFocus = true } = {}) {
    if (closed) return;
    closed = true;
    openCount -= 1;
    scrim.remove();
    document.removeEventListener('keydown', onKeydown, true);
    if (restoreFocus && opener && opener.isConnected) opener.focus();
    if (onClose) onClose();
  }

  function onKeydown(event) {
    if (!scrim.isConnected) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === 'Tab') trapTab(panel, event);
  }

  scrim.addEventListener('mousedown', (event) => {
    if (event.target === scrim) close();
  });
  document.addEventListener('keydown', onKeydown, true);
  document.body.append(scrim);
  openCount += 1;
  const target = typeof initialFocus === 'function' ? initialFocus() : initialFocus;
  if (target) target.focus();
  return { close, panel };
}
