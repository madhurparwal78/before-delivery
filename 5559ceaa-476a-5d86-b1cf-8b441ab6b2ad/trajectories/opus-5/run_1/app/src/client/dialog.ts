import { el, focusables, on } from './dom.js';

export interface Dialog {
  readonly panel: HTMLElement;
  close(): void;
}

interface Options {
  role: 'dialog' | 'alertdialog';
  name: string;
  heading?: string;
  destructive?: boolean;
}

/**
 * Opens a focus-trapped panel. Escape closes it and returns focus to whatever
 * opened it.
 */
export function openDialog(options: Options, build: (dialog: Dialog) => Node[]): Dialog {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const scrim = el('div', { class: 'scrim' });
  const panel = el('div', {
    role: options.role,
    'aria-modal': 'true',
    'aria-label': options.name,
  });
  scrim.append(panel);

  let open = true;
  const dialog: Dialog = {
    panel,
    close: () => {
      if (!open) return;
      open = false;
      scrim.remove();
      document.removeEventListener('keydown', onKeyDown, true);
      opener?.focus();
    },
  };

  function onKeyDown(event: KeyboardEvent): void {
    if (!panel.isConnected) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      event.preventDefault();
      dialog.close();
      return;
    }
    if (event.key !== 'Tab') return;
    const stops = focusables(panel);
    if (stops.length === 0) return;
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  if (options.heading !== undefined) {
    panel.append(el('h2', {}, [options.heading]));
  }
  panel.append(...build(dialog));
  document.body.append(scrim);
  document.addEventListener('keydown', onKeyDown, true);

  on(scrim, 'mousedown', (event) => {
    if (event.target === scrim) dialog.close();
  });

  const stops = focusables(panel);
  const cancel = stops.find((node) => node.textContent === 'Cancel');
  const target = options.destructive === true && cancel !== undefined ? cancel : stops[0];
  target?.focus();

  return dialog;
}
