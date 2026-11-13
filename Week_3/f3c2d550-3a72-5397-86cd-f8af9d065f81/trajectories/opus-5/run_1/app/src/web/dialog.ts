import { element, focusables } from './dom.js';
import { dialogCloseSlide, dialogOpenSlide } from './motion.js';

/** Every dialog keeps Tab inside it, closes on Escape and returns focus to its opener. */

export interface DialogHandle {
  readonly element: HTMLElement;
  close(): void;
}

let openDialogs = 0;

export function openDialog(options: {
  label: string;
  opener: HTMLElement;
  build: (close: () => void) => Array<Node | string>;
  initialFocus?: (dialog: HTMLElement) => HTMLElement | null;
  onClosed?: () => void;
}): DialogHandle {
  const dialog = element('div', {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': options.label,
    class: 'dialog',
  });
  const backdrop = element('div', { class: 'dialog-backdrop' }, [dialog]);
  let closed = false;

  const close = (): void => {
    if (closed) return;
    closed = true;
    openDialogs -= 1;
    document.removeEventListener('keydown', onKeyDown, true);
    options.opener.focus();
    dialogCloseSlide(dialog, () => {
      backdrop.remove();
      options.onClosed?.();
    });
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const order = focusables(dialog);
    if (order.length === 0) return;
    const first = order[0]!;
    const last = order[order.length - 1]!;
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  dialog.append(...options.build(close));
  document.body.append(backdrop);
  openDialogs += 1;
  document.addEventListener('keydown', onKeyDown, true);
  dialogOpenSlide(dialog);
  const target = options.initialFocus?.(dialog) ?? focusables(dialog)[0] ?? dialog;
  target.focus();

  return { element: dialog, close };
}

export function aDialogIsOpen(): boolean {
  return openDialogs > 0;
}
