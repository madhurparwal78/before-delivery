// Sign in: email and password, Enter submits, next honoured after success.

import type { ScreenKit } from './main';
import { el, clear } from './dom';
import { apiJson, ApiFailure } from './apiClient';
import { renderProblems } from './ui';
import { readNextParam, nextAllowed, landingPath } from './router';

export function renderSignInScreen(kit: ScreenKit, search: string): () => void {
  const { main, app } = kit;
  clear(main);
  const wrap = el('div', { class: 'single-column' });

  const announce = el('div', { role: 'status', 'aria-label': 'Account updates', 'aria-live': 'polite' });
  const problems = el('div');

  const heading = el('h1', { text: 'Sign in', class: 'wordmark' });

  const emailHolder = el('div', { class: 'field' });
  const email = el('input', { type: 'text', id: 'email', autocomplete: 'email' }) as HTMLInputElement;
  emailHolder.append(el('label', { for: 'email', text: 'Email' }), email);

  const passwordHolder = el('div', { class: 'field' });
  const password = el('input', { type: 'password', id: 'password', autocomplete: 'current-password' }) as HTMLInputElement;
  passwordHolder.append(el('label', { for: 'password', text: 'Password' }), password);

  const submit = el('button', { class: 'primary', text: 'Sign in' }) as HTMLButtonElement;

  const form = el('form');
  form.append(announce, problems, heading, emailHolder, passwordHolder, submit);

  const fieldsOf = (field: string): HTMLElement | null => {
    if (field === 'email') return email;
    if (field === 'password') return password;
    return null;
  };

  form.addEventListener('submit', (event) => void handleSubmit(event));

  async function handleSubmit(event: Event): Promise<void> {
    event.preventDefault();
    if (submit.getAttribute('aria-busy') === 'true') return;
    submit.textContent = 'Signing in...';
    submit.setAttribute('aria-busy', 'true');
    submit.setAttribute('aria-disabled', 'true');
    try {
      await apiJson('POST', '/api/session', { email: email.value, password: password.value });
      await app.loadMe();
      const role = app.role();
      const next = readNextParam(search);
      const destination =
        role !== null && next !== null ? nextAllowed(next, role) ?? landingPath(role) : role === null ? '/' : landingPath(role);
      window.location.href = destination;
    } catch (err) {
      submit.textContent = 'Sign in';
      submit.removeAttribute('aria-busy');
      submit.removeAttribute('aria-disabled');
      if (err instanceof ApiFailure) {
        announce.textContent = err.error;
        if (err.status === 422) {
          renderProblems(problems, err.fields ?? {}, fieldsOf);
        }
      }
    }
  }

  wrap.append(form);
  main.append(wrap);
  email.focus();
  return () => {};
}
