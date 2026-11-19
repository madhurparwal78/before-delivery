import { el, focusableIn, trapTab } from '../dom.js';
import { button } from '../widgets.js';

const EXIT_MS = 250;

export interface Sheet {
  root: HTMLElement;
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
}

export function createSheet(opener: HTMLButtonElement, reduced: () => boolean): Sheet {
  const root = el('div', { role: 'dialog', 'aria-label': 'People and chat', class: 'sheet' });
  root.hidden = true;
  root.setAttribute('inert', '');
  const close = button('Close');
  root.append(close);
  let hideTimer: number | null = null;

  const hide = (): void => {
    root.hidden = true;
    root.setAttribute('inert', '');
    root.classList.remove('open', 'closing');
    hideTimer = null;
  };

  const sheet: Sheet = {
    root,
    isOpen: () => !root.hidden,
    open: () => {
      if (hideTimer !== null) {
        window.clearTimeout(hideTimer);
        hideTimer = null;
      }
      root.hidden = false;
      root.removeAttribute('inert');
      root.classList.add('open');
      root.classList.remove('closing');
      const first = focusableIn(root)[0];
      if (first !== undefined) first.focus();
    },
    close: () => {
      if (root.hidden) return;
      if (opener.isConnected) opener.focus();
      if (reduced()) {
        hide();
        return;
      }
      root.classList.add('closing');
      hideTimer = window.setTimeout(hide, EXIT_MS);
    }
  };

  close.addEventListener('click', () => sheet.close());
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      sheet.close();
      return;
    }
    trapTab(root, event);
  });
  opener.addEventListener('click', () => {
    if (sheet.isOpen() && !root.classList.contains('closing')) {
      sheet.close();
      return;
    }
    sheet.open();
  });
  return sheet;
}
