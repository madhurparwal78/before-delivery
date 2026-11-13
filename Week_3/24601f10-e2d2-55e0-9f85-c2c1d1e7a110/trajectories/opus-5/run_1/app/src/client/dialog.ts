import { COPY } from '../shared/copy';
import { focusable, h } from './dom';

export interface DialogHandle {
  root: HTMLElement;
  status: HTMLElement;
  close: (returnFocus?: boolean) => void;
  setPending: (pending: boolean, buttons: HTMLButtonElement[]) => void;
}

interface DialogOptions {
  title: string;
  opener: HTMLElement | null;
  build: (dialog: DialogHandle) => HTMLElement[];
  onEscape?: (dialog: DialogHandle) => boolean;
  focusFirst?: () => HTMLElement | null;
}

const stack: DialogHandle[] = [];
const escapes = new Map<DialogHandle, () => void>();
const pendingFocus = new Map<DialogHandle, HTMLElement | null>();

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  const top = stack[stack.length - 1];
  if (top === undefined) return;
  event.preventDefault();
  event.stopPropagation();
  escapes.get(top)?.();
});

export const anyDialogOpen = (): boolean => stack.length > 0;

/** Every dialog is modal: Tab wraps inside it, Escape closes it, focus returns to its opener. */
export const openDialog = (options: DialogOptions): DialogHandle => {
  const status = h('div', { role: 'status', 'aria-label': 'Dialog status', class: 'dialog-status' });
  const surface = h('div', {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': options.title,
    class: 'dialog',
  });
  const scrim = h('div', { class: 'scrim' }, surface);

  const handle: DialogHandle = {
    root: surface,
    status,
    close: (returnFocus = true) => {
      const index = stack.indexOf(handle);
      if (index !== -1) stack.splice(index, 1);
      escapes.delete(handle);
      scrim.remove();
      if (returnFocus && options.opener !== null && document.body.contains(options.opener)) {
        options.opener.focus();
      }
    },
    setPending: (pending, buttons) => {
      const focusedBefore = document.activeElement as HTMLElement | null;
      for (const button of buttons) button.disabled = pending;
      status.textContent = pending ? COPY.savingDots : '';
      if (pending) pendingFocus.set(handle, focusedBefore);
      else {
        const restore = pendingFocus.get(handle);
        pendingFocus.delete(handle);
        if (restore !== null && restore !== undefined && surface.contains(restore)) restore.focus();
        else if (document.activeElement === document.body) focusable(surface)[0]?.focus();
      }
    },
  };

  const content = options.build(handle);
  surface.append(h('h2', { class: 'dialog-title' }, options.title), ...content, status);

  escapes.set(handle, () => {
    if (options.onEscape !== undefined && !options.onEscape(handle)) return;
    handle.close();
  });

  surface.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') return;
    if (event.key !== 'Tab') return;
    const items = focusable(surface);
    if (items.length === 0) return;
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  document.body.appendChild(scrim);
  stack.push(handle);
  const target = options.focusFirst?.() ?? focusable(surface)[0] ?? null;
  target?.focus();
  return handle;
};

export const dialogError = (dialog: DialogHandle, message: string): void => {
  dialog.status.textContent = message;
  const first = dialog.root.querySelector<HTMLElement>('input[type="number"]');
  first?.focus();
};
