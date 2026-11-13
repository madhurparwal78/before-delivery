import { el, focusable } from './dom';

export interface DialogHandle {
  element: HTMLElement;
  close(): void;
}

interface DialogOptions {
  role: 'dialog' | 'alertdialog';
  name: string;
  body: (Node | string)[];
  buttons: HTMLElement[];
  closeOnEscape: boolean;
  focus: HTMLElement;
  returnFocus?: () => HTMLElement | null;
}

const stack: DialogHandle[] = [];

export function dialogOpen(): boolean {
  return stack.length > 0;
}

export function closeTopDialog(): void {
  stack.at(-1)?.close();
}

/** A modal dialog whose Tab order never reaches the page behind it. */
export function openDialog(options: DialogOptions): DialogHandle {
  const panel = el('div', {
    role: options.role,
    'aria-modal': 'true',
    'aria-label': options.name,
    class: 'dialog',
  });
  const body = el('div', { class: 'dialog-body' }, options.body);
  const actions = el('div', { class: 'dialog-actions' }, options.buttons);
  panel.append(body, actions);
  const overlay = el('div', { class: 'dialog-overlay' }, [panel]);

  const handle: DialogHandle = {
    element: panel,
    close: () => {
      const index = stack.indexOf(handle);
      if (index < 0) return;
      stack.splice(index, 1);
      overlay.remove();
      document.removeEventListener('keydown', onKeydown, true);
      const target = options.returnFocus?.();
      target?.focus();
    },
  };

  function onKeydown(event: KeyboardEvent): void {
    if (stack.at(-1) !== handle) return;
    if (event.key === 'Escape') {
      if (options.closeOnEscape) {
        event.preventDefault();
        handle.close();
      }
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusable(panel);
    if (items.length === 0) return;
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    const active = document.activeElement;
    event.preventDefault();
    if (event.shiftKey) (active === first ? last : previous(items, active)).focus();
    else (active === last ? first : next(items, active)).focus();
  }

  document.addEventListener('keydown', onKeydown, true);
  document.body.append(overlay);
  stack.push(handle);
  options.focus.focus();
  return handle;
}

function next(items: HTMLElement[], active: Element | null): HTMLElement {
  const index = items.findIndex((item) => item === active);
  return (items[index + 1] ?? items[0]) as HTMLElement;
}

function previous(items: HTMLElement[], active: Element | null): HTMLElement {
  const index = items.findIndex((item) => item === active);
  return (items[index - 1] ?? items[items.length - 1]) as HTMLElement;
}
