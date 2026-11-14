import { ApiFailure } from '../lib/api.ts';
import { h } from '../lib/dom.ts';
import { alertText } from '../lib/live.ts';
import type { Field } from './fields.ts';

// A refused form: every item lands beside its field, the refusal goes to #alert, and a refusal that names no field
// is written above the buttons so the sentence is never only in the live region.

export function clearFailure(form: HTMLFormElement, fields: Field[]): void {
  for (const field of fields) field.showError(null);
  form.querySelector('.form-error')?.remove();
}

export function showFailure(form: HTMLFormElement, fields: Field[], failure: ApiFailure): void {
  clearFailure(form, fields);
  const named = fields.filter((field) => failure.items.some((item) => item.key === field.name));
  for (const field of named) field.showError(failure.items.find((item) => item.key === field.name)?.message ?? null);
  if (named.length === 0) form.querySelector('.actions')?.before(h('p', { class: 'error-text form-error' }, failure.message));
  alertText(failure.message);
  named[0]?.input.focus();
}
