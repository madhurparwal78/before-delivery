import type { App } from '../app';
import { el } from '../dom';

export interface FormFieldSpec {
  name: string;
  label: string;
  kind?: 'text' | 'email' | 'password' | 'number';
  hint?: string;
  onKeyDown?: (event: KeyboardEvent) => void;
}

/** A labelled control bound to the screen's form state, with its field error beside it. */
export function formField(app: App, spec: FormFieldSpec): HTMLElement {
  const id = `field-${spec.name}`;
  const message = app.state.formErrors[spec.name];
  const value = app.state.formFields[spec.name] ?? '';
  return el(
    'div',
    { class: 'field' },
    el('label', { for: id }, spec.label),
    el('input', {
      id,
      type: spec.kind ?? 'text',
      value,
      'data-focus-key': `form:${spec.name}`,
      'aria-invalid': message ? 'true' : null,
      'aria-describedby': message ? `${id}-error` : spec.hint ? `${id}-hint` : null,
      onInput: (event: Event) => {
        app.state.formFields[spec.name] = (event.target as HTMLInputElement).value;
      },
      onKeydown: spec.onKeyDown ?? null,
    }),
    spec.hint ? el('span', { class: 'hint', id: `${id}-hint` }, spec.hint) : null,
    message
      ? el('span', { class: 'field-error', id: `${id}-error`, 'data-field-error': spec.name }, message)
      : null,
  );
}

export function countsRow(
  overdue: number,
  awaiting: number,
): HTMLElement {
  return el(
    'div',
    { class: 'counts' },
    el(
      'p',
      { role: 'status', 'aria-label': 'Overdue count', class: 'count' },
      `${overdue} overdue`,
    ),
    el(
      'p',
      { role: 'status', 'aria-label': 'Awaiting approval count', class: 'count' },
      `${awaiting} awaiting approval`,
    ),
  );
}
