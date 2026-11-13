import { api } from '../api.js';
import type { AppContext } from '../app.js';
import { el } from '../dom.js';

export function mountSignIn(root: HTMLElement, context: AppContext): void {
  const field = el('input', { type: 'password', id: 'passphrase', class: 'field' });
  const error = el('p', { class: 'field-error' });
  const submit = el('button', { type: 'submit', class: 'primary' }, ['Sign in']);
  const form = el('form', { class: 'sign-in' }, [
    el('h1', {}, ['Skinout']),
    el('label', { for: 'passphrase' }, ['Passphrase']),
    field,
    error,
    submit,
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void api('POST', '/api/session', { body: { passphrase: field.value } }).then((result) => {
      if (result.ok) {
        context.navigate('/trips', { replace: true });
        return;
      }
      error.textContent = "That passphrase didn't match.";
      field.focus();
    });
  });
  root.append(el('div', { class: 'sheet centred' }, [form]));
  field.focus();
}
