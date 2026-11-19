import { el, focusableIn, reducedMotion } from './dom.js';

const DIALOG_FADE_MS = 160;

export interface DialogHandle {
  panel: HTMLElement;
  close: () => void;
}

interface DialogOptions {
  label: string;
  role?: 'dialog' | 'alertdialog';
  opener?: HTMLElement | null;
  className?: string;
  focusOnClose?: () => HTMLElement | null;
  onClose?: () => void;
}

const stack: DialogHandle[] = [];

export const modalDialogsOpen = (): number => stack.length;

/** Modal dialogs keep Tab inside, close on Escape and return focus to their opener. */
export const openDialog = (
  options: DialogOptions,
  build: (handle: { close: () => void }) => (Node | string)[],
): DialogHandle => {
  const backdrop = el('div', { class: 'qy-backdrop' });
  const panel = el('div', {
    class: `qy-dialog ${options.className ?? ''}`.trim(),
    role: options.role ?? 'dialog',
    'aria-modal': 'true',
    'aria-label': options.label,
  });
  const handle: DialogHandle = { panel, close: () => undefined };

  const finish = (): void => {
    const index = stack.indexOf(handle);
    if (index >= 0) stack.splice(index, 1);
    document.removeEventListener('keydown', onKeyDown, true);
    // Leaves the accessibility tree at once, then fades out of view.
    panel.setAttribute('aria-hidden', 'true');
    panel.removeAttribute('role');
    const done = (): void => backdrop.remove();
    if (reducedMotion()) done();
    else {
      backdrop.style.opacity = '0';
      window.setTimeout(done, DIALOG_FADE_MS);
    }
    const landing = options.focusOnClose?.() ?? options.opener ?? null;
    landing?.focus();
    options.onClose?.();
  };
  handle.close = finish;

  const onKeyDown = (event: KeyboardEvent): void => {
    if (stack.at(-1) !== handle) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finish();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = focusableIn(panel);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  panel.append(...build({ close: finish }));
  backdrop.append(panel);
  document.body.append(backdrop);
  stack.push(handle);
  document.addEventListener('keydown', onKeyDown, true);

  if (!reducedMotion()) {
    backdrop.style.opacity = '0';
    requestAnimationFrame(() => {
      backdrop.style.opacity = '1';
    });
  }
  const focusable = focusableIn(panel);
  focusable[0]?.focus();
  return handle;
};

export const fieldError = (input: HTMLElement, message: string | null): void => {
  const id = `${input.id}-error`;
  const existing = document.getElementById(id);
  if (existing) existing.remove();
  if (message === null) {
    input.removeAttribute('aria-describedby');
    input.removeAttribute('aria-invalid');
    return;
  }
  const error = el('p', { id, class: 'qy-field-error', text: message });
  input.setAttribute('aria-describedby', id);
  input.setAttribute('aria-invalid', 'true');
  input.insertAdjacentElement('afterend', error);
};
