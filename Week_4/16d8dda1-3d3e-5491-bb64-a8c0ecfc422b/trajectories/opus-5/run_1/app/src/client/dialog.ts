import { element } from './dom.js';

export interface Dialog {
  root: HTMLElement;
  open: (opener: HTMLElement) => void;
  close: () => void;
  isOpen: () => boolean;
}

const focusable = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]';

/** Dialogs move focus in, wrap Tab inside, and give focus back to their opener. */
export function makeDialog(name: string, contents: HTMLElement[], className = ''): Dialog {
  const panel = element('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': name, class: `dialog ${className}` }, [
    element('h2', { class: 'dialog-title' }, [name]),
    ...contents
  ]);
  const root = element('div', { class: 'dialog-layer', hidden: true }, [panel]);
  let opener: HTMLElement | null = null;

  const controls = (): HTMLElement[] => [...panel.querySelectorAll<HTMLElement>(focusable)].filter((node) => !node.hidden);

  const close = (): void => {
    if (root.hidden) return;
    root.hidden = true;
    panel.classList.remove('is-open');
    const giveBack = opener;
    opener = null;
    giveBack?.focus();
  };

  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = controls();
    if (items.length === 0) return;
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  return {
    root,
    open: (from) => {
      opener = from;
      root.hidden = false;
      requestAnimationFrame(() => panel.classList.add('is-open'));
      panel.classList.add('is-open');
      controls()[0]?.focus();
    },
    close,
    isOpen: () => !root.hidden
  };
}
