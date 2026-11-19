import { el } from './dom.js';

export interface LabelledField {
  wrap: HTMLElement;
  input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  setError: (message: string | null) => void;
  id: string;
}

let counter = 0;

export function labelledField(options: {
  name: string;
  kind?: 'text' | 'email' | 'password' | 'date' | 'number' | 'textarea' | 'select';
  value?: string;
  hint?: string;
  options?: string[];
  placeholder?: string;
}): LabelledField {
  counter += 1;
  const id = `field-${counter}`;
  const errorId = `${id}-error`;
  const kind = options.kind ?? 'text';
  const input =
    kind === 'textarea'
      ? el('textarea', { id, class: 'input input--area', 'aria-label': options.name })
      : kind === 'select'
        ? el('select', { id, class: 'input', 'aria-label': options.name })
        : el('input', {
            id,
            type: kind,
            class: 'input',
            'aria-label': options.name,
            value: options.value ?? '',
          });
  if (kind === 'select') {
    for (const option of options.options ?? []) {
      (input as HTMLSelectElement).appendChild(el('option', { value: option }, option));
    }
    if (options.value !== undefined) (input as HTMLSelectElement).value = options.value;
  } else if (kind === 'textarea' && options.value) {
    (input as HTMLTextAreaElement).value = options.value;
  }
  const error = el('p', { class: 'field__error', id: errorId, hidden: true });
  const wrap = el('div', { class: 'field' }, [
    el('label', { class: 'field__label', for: id }, options.name),
    options.hint ? el('p', { class: 'field__hint' }, options.hint) : null,
    input,
    error,
  ]);
  return {
    wrap,
    input: input as HTMLInputElement,
    id,
    setError: (message) => {
      if (message === null) {
        error.hidden = true;
        error.textContent = '';
        input.removeAttribute('aria-invalid');
        input.removeAttribute('aria-describedby');
        return;
      }
      error.hidden = false;
      error.textContent = message;
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', errorId);
    },
  };
}

export function errorSummary(
  entries: { message: string; target: HTMLElement }[],
): HTMLElement {
  const list = el(
    'ul',
    { class: 'summary__list' },
    entries.map((entry) => {
      const link = el('a', { href: `#${entry.target.id}` }, entry.message);
      link.addEventListener('click', (event) => {
        event.preventDefault();
        entry.target.focus();
      });
      return el('li', {}, link);
    }),
  );
  return el('div', { role: 'alert', class: 'summary', tabindex: '-1' }, [
    el('h2', { class: 'summary__heading' }, 'There is a problem'),
    list,
  ]);
}
