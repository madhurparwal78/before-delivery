/**
 * Field errors and the error summary — one link per field error, each link
 * moving focus to its field.
 */
import { h } from './ui.ts';

export interface FieldErrors {
  [field: string]: string;
}

export function renderFieldErrors(container: HTMLElement, fields: FieldErrors | undefined): void {
  container.querySelectorAll<HTMLElement>('[data-field-error]').forEach((el) => el.remove());
  if (!fields) return;
  for (const [field, message] of Object.entries(fields)) {
    const name = field.split('.').pop() ?? field;
    const target = container.querySelector<HTMLElement>(`[data-field="${name}"]`);
    if (target) {
      const error = h('p', { class: 'error', 'data-field-error': name, text: message });
      target.after(error);
    }
  }
}

export function fieldWrap(labelText: string, control: HTMLElement, fieldName: string): HTMLElement {
  control.setAttribute('data-field', fieldName);
  const id = `field-${fieldName}-${Math.random().toString(36).slice(2, 8)}`;
  if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) {
    control.id = id;
  }
  return h('div', { class: 'field' }, h('label', { for: id, text: labelText }), control);
}

export function errorSummary(fields: FieldErrors, container: HTMLElement, getField: (name: string) => HTMLElement | null): HTMLElement {
  const list = h(
    'ul',
    null,
    ...Object.entries(fields).map(([field, message]) =>
      h('li', null, h('a', {
        href: '#',
        text: message,
        onclick: (event: Event) => {
          event.preventDefault();
          const target = getField(field);
          if (target) {
            target.focus();
            target.scrollIntoView({ block: 'center' });
          }
        },
      })),
    ),
  );
  const summary = h('details', { class: 'error-summary-container' },
    h('summary', { class: 'error-summary', text: 'There is a problem' }),
    list,
  );
  void container;
  return summary;
}
