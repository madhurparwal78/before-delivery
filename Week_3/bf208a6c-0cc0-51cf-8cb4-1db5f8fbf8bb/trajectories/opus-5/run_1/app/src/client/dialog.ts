import { el } from './dom';
import { slideDown, slideUp } from './motion';

export interface DialogHandle {
  root: HTMLElement;
  close: () => void;
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export const openDialog = (options: {
  name: string;
  opener: HTMLElement | null;
  alert?: boolean;
  content: (handle: DialogHandle) => Array<Node | string>;
  focus?: (root: HTMLElement) => HTMLElement | null;
  onClose?: () => void;
}): DialogHandle => {
  const asSheet = window.innerWidth < 768;
  const dialog = el('div', {
    class: asSheet ? 'dialog bottom-sheet' : 'dialog',
    role: options.alert === true ? 'alertdialog' : 'dialog',
    'aria-modal': 'true',
    'aria-label': options.name,
  });
  const scrim = el('div', { class: asSheet ? 'scrim sheet-mode' : 'scrim' }, [dialog]);

  const handle: DialogHandle = {
    root: dialog,
    close: () => {
      document.removeEventListener('keydown', onKeyDown, true);
      const finish = (): void => {
        scrim.remove();
        options.onClose?.();
        options.opener?.focus();
      };
      if (asSheet) void slideDown(dialog).then(finish);
      else finish();
    },
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!scrim.isConnected) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      handle.close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (node) => node.offsetParent !== null || node === document.activeElement,
    );
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    }
  };

  dialog.append(...options.content(handle));
  document.body.append(scrim);
  document.addEventListener('keydown', onKeyDown, true);
  if (asSheet) slideUp(dialog);
  const target = options.focus?.(dialog) ?? dialog.querySelector<HTMLElement>(FOCUSABLE);
  target?.focus();
  return handle;
};
