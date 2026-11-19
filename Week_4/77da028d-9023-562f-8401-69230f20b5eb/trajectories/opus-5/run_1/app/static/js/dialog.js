import { el, reducedMotion } from './dom.js';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),' +
  ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const open = [];

/**
 * Opens a modal dialog or a sliding sheet. Focus wraps inside it, Escape
 * closes it and focus returns to the control that opened it.
 */
export function openDialog({ name, body, sheet = false, onClose }) {
  const opener = document.activeElement;
  const panel = el(
    'div',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': name },
    body,
  );
  const scrim = el('div', { class: sheet ? 'scrim sheet' : 'scrim' }, [panel]);
  const entry = { scrim, panel, opener, onClose, name };

  const keydown = (event) => {
    if (open[open.length - 1] !== entry) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(entry);
      return;
    }
    if (event.key !== 'Tab') return;
    const stops = [...panel.querySelectorAll(FOCUSABLE)].filter(
      (node) => node.offsetParent !== null || node === document.activeElement,
    );
    if (!stops.length) return;
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  entry.keydown = keydown;
  scrim.addEventListener('mousedown', (event) => {
    if (event.target === scrim) close(entry);
  });
  document.addEventListener('keydown', keydown, true);
  document.body.append(scrim);
  open.push(entry);
  const firstStop = panel.querySelector(FOCUSABLE);
  if (firstStop) firstStop.focus();
  return entry;
}

export function close(entry) {
  const index = open.indexOf(entry);
  if (index === -1) return;
  open.splice(index, 1);
  document.removeEventListener('keydown', entry.keydown, true);
  const remove = () => entry.scrim.remove();
  if (reducedMotion()) {
    remove();
  } else {
    entry.scrim.classList.add('leaving');
    entry.scrim.addEventListener('animationend', remove, { once: true });
    setTimeout(remove, 500);
  }
  if (entry.opener && document.contains(entry.opener)) entry.opener.focus();
  if (entry.onClose) entry.onClose();
}

export function closeAll() {
  while (open.length) close(open[open.length - 1]);
}

export function isOpen(name) {
  return open.some((entry) => entry.name === name);
}
