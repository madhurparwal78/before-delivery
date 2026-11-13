import { el } from './dom.js';

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select, textarea, [tabindex]';

export interface DialogHandle {
  readonly root: HTMLElement;
  readonly body: HTMLElement;
  close(): void;
  showError(message: string): void;
  clearError(): void;
}

const stack: DialogHandle[] = [];

export function topDialog(): DialogHandle | null {
  return stack.at(-1) ?? null;
}

/**
 * Opens a modal that keeps focus inside itself. Escape and Cancel both close it and return focus
 * to the control that opened it.
 */
export function openDialog(options: {
  label: string;
  heading: string;
  opener: HTMLElement | null;
  content: Node[];
  actions: Node[];
}): DialogHandle {
  const error = el('p', { class: 'dialog__error', role: 'presentation' });
  const body = el('div', {}, options.content);
  const dialog = el(
    'div',
    { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': options.label },
    [el('h2', {}, [options.heading]), body, error, el('div', { class: 'dialog__actions' }, options.actions)],
  );
  const scrim = el('div', { class: 'scrim' }, [dialog]);

  const handle: DialogHandle = {
    root: scrim,
    body,
    close() {
      const index = stack.indexOf(handle);
      if (index === -1) return;
      stack.splice(index, 1);
      scrim.remove();
      document.removeEventListener('keydown', onKeyDown, true);
      options.opener?.focus();
    },
    showError(message) {
      error.textContent = message;
    },
    clearError() {
      error.textContent = '';
    },
  };

  function onKeyDown(event: KeyboardEvent): void {
    if (stack.at(-1) !== handle) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      event.preventDefault();
      handle.close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (node) => node.offsetParent !== null || node === document.activeElement,
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  document.addEventListener('keydown', onKeyDown, true);
  document.body.append(scrim);
  stack.push(handle);
  dialog.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  return handle;
}

export interface FieldOptions {
  label: string;
  type?: 'text' | 'email' | 'password';
  value?: string;
  hint?: string;
  multiline?: boolean;
}

let fieldSequence = 0;

export interface LabelledField {
  wrapper: HTMLElement;
  input: HTMLInputElement | HTMLTextAreaElement;
  setError(message: string | null): void;
}

/** A field whose error sits under it, linked so assistive technology reads them together. */
export function labelledField(options: FieldOptions): LabelledField {
  fieldSequence += 1;
  const id = `field-${fieldSequence}`;
  const errorId = `${id}-error`;
  const input = options.multiline
    ? el('textarea', { id, 'aria-label': options.label })
    : el('input', { id, type: options.type ?? 'text', 'aria-label': options.label });
  if (options.value) input.value = options.value;
  const error = el('span', { class: 'field-error', id: errorId });
  const wrapper = el('div', { class: 'field' }, [
    el('label', { for: id }, [options.label]),
    input,
    options.hint ? el('span', { class: 'evidence__empty' }, [options.hint]) : null,
    error,
  ]);
  return {
    wrapper,
    input,
    setError(message) {
      error.textContent = message ?? '';
      if (message) {
        input.setAttribute('aria-describedby', errorId);
        input.setAttribute('aria-invalid', 'true');
      } else {
        input.removeAttribute('aria-describedby');
        input.removeAttribute('aria-invalid');
      }
    },
  };
}
