import { ApiCallError, post } from '../api.js';
import { el, find } from '../dom.js';
import { band, mount, notice, noticesStrip } from '../shell.js';

export function renderSignIn(): void {
  const form = el('form', { class: 'sign-in', novalidate: true }, [
    el('div', { class: 'field' }, [
      el('label', { for: 'email', text: 'Email' }),
      el('input', { id: 'email', name: 'email', type: 'email', autocomplete: 'username' }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { for: 'password', text: 'Password' }),
      el('input', { id: 'password', name: 'password', type: 'password', autocomplete: 'current-password' }),
    ]),
    el('button', { type: 'submit', class: 'primary', text: 'Sign in' }),
  ]);
  mount(band({ brand: 'Gatecut' }), noticesStrip(), el('main', { class: 'sheet-area' }, [form]));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    notice('Signing in…');
    const email = find<HTMLInputElement>('#email', form)?.value ?? '';
    const password = find<HTMLInputElement>('#password', form)?.value ?? '';
    void post('/api/session', { email, password })
      .then(() => {
        window.location.assign('/');
      })
      .catch((error: unknown) => {
        notice(error instanceof ApiCallError ? error.failure.message : 'That email and password do not match.');
      });
  });
}
