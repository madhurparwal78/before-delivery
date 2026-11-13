import { el, qsOpt } from './dom.js';

// Dialogs: while any dialog is open, Tab and Shift+Tab wrap within it and
// never reach the page behind. Puzzle solved, Not counted and Duel over
// close on Escape; Paused and Game over ignore it.

export interface DialogOptions {
  name: string;
  role: 'dialog' | 'alertdialog';
  paragraph: string;
  buttons: Array<{ label: string; onClick: () => void; autofocus?: boolean }>;
  escapeCloses: boolean;
  id?: string;
  onKeydown?: (event: KeyboardEvent, close: () => void) => void;
}

export function openDialog(opts: DialogOptions): () => void {
  const backdrop = el('div', { class: 'dialog-backdrop' });
  const panel = el('div', { class: 'dialog-panel', role: opts.role, 'aria-modal': 'true', 'aria-label': opts.name });
  if (opts.id) panel.id = opts.id;
  panel.append(el('h2', {}, [opts.name]));
  if (opts.paragraph) panel.append(el('p', {}, [opts.paragraph]));

  const actions = el('div', { class: 'dialog-actions' });
  const buttons: HTMLElement[] = [];
  let first: HTMLElement | null = null;

  for (const spec of opts.buttons) {
    const btn = el('button', { class: 'button', type: 'button' }, [spec.label]);
    btn.addEventListener('click', () => {
      spec.onClick();
    });
    buttons.push(btn);
    if (spec.autofocus && !first) first = btn;
    actions.append(btn);
  }
  panel.append(actions);
  backdrop.append(panel);
  document.body.append(backdrop);

  // Focus inside the dialog; Tab wraps within it.
  (first ?? buttons[0] ?? panel).focus();

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && opts.escapeCloses) {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'Tab') {
      const focusables = buttons.filter((b) => !b.hasAttribute('disabled'));
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      const firstEl = focusables[0];
      const lastEl = focusables[focusables.length - 1];
      if (!active || !panel.contains(active)) {
        event.preventDefault();
        firstEl.focus();
        return;
      }
      if (event.shiftKey && active === firstEl) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && active === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    }
    opts.onKeydown?.(event, close);
  };

  function close(): void {
    document.removeEventListener('keydown', onKeydown, true);
    backdrop.remove();
  }

  document.addEventListener('keydown', onKeydown, true);
  return close;
}

export function currentDialog(): HTMLElement | null {
  return qsOpt<HTMLElement>('.dialog-panel');
}

export function dialogOpen(): boolean {
  return currentDialog() !== null;
}
