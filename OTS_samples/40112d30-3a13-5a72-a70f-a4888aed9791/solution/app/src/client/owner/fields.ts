import { h } from '../lib/dom.ts';

// A labelled text box with its own error line: the message sits beside the box under a pink left edge,
// and the box says so with aria-invalid and aria-describedby.

export interface Field {
  readonly name: string;
  readonly row: HTMLDivElement;
  readonly input: HTMLInputElement;
  showError: (message: string | null) => void;
}

export interface FieldOptions {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'password';
  autocomplete?: string;
}

export function textField({ name, label, type = 'text', autocomplete }: FieldOptions): Field {
  const id = `field-${name}`;
  const errorId = `error-${name}`;
  // The brief names every field a textbox, and a password input has no role of its own.
  const input = h('input', { id, name, type, autocomplete, role: type === 'password' ? 'textbox' : null });
  const row = h('div', { class: 'field' }, h('label', { for: id }, label), input);
  const showError = (message: string | null): void => {
    row.querySelector(`#${errorId}`)?.remove();
    if (message === null) {
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
      return;
    }
    row.append(h('p', { id: errorId, class: 'error-text' }, message));
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', errorId);
  };
  return { name, row, input, showError };
}
