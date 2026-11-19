// Sign-in and join screens.

import { el, navigate, statusRegion, setStatus } from './lib';
import { SIGN_IN_STATUS, JOIN_STATUS } from '../src-shared/copy';
import type { User } from '../src-shared/protocol';

export async function renderSignIn(): Promise<void> {
  document.title = 'Sign in — Lowfield';
  const root = document.getElementById('root')!;
  root.innerHTML = '';
  const card = el('div', { class: 'auth-card' });
  card.append(el('h1', {}, 'Sign in'));
  const form = el('form');
  const email = el('input', { type: 'text', id: 'email', autocomplete: 'username' });
  const password = el('input', { type: 'password', id: 'password', autocomplete: 'current-password' });
  const status = statusRegion('Sign-in status');
  const submit = el('button', { type: 'submit', class: 'accent' }, 'Sign in');
  const emailField = el('div', { class: 'field' });
  emailField.append(el('label', { for: 'email' }, 'Email'), email);
  const pwField = el('div', { class: 'field' });
  pwField.append(el('label', { for: 'password' }, 'Password'), password);
  form.append(emailField, pwField, submit, status);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    submit.disabled = true;
    try {
      const res = await fetch('/api/auth/sign-in', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.value, password: password.value }),
      });
      if (res.ok) {
        const data = (await res.json()) as { landing: string; user: User };
        // Sign-in lands each role on its published route; the address bar updates without a reload.
        await navigate(data.landing, true);
        return;
      }
      setStatus(status, SIGN_IN_STATUS.invalid);
    } catch {
      setStatus(status, 'Something went wrong. Try again.');
    } finally {
      submit.disabled = false;
    }
  });
  card.append(form);
  root.append(el('div', { class: 'auth-wrap' }, card));
}

export async function renderJoin(token: string): Promise<void> {
  document.title = 'Join workspace — Lowfield';
  const root = document.getElementById('root')!;
  root.innerHTML = '';
  const card = el('div', { class: 'auth-card' });
  card.append(el('h1', {}, 'Join workspace'));
  const form = el('form');
  const password = el('input', { type: 'password', id: 'password', autocomplete: 'new-password' });
  const status = statusRegion('Join status');
  const submit = el('button', { type: 'submit', class: 'accent' }, 'Join workspace');
  const pwField = el('div', { class: 'field' });
  pwField.append(el('label', { for: 'password' }, 'Choose a password'), password);
  form.append(pwField, submit, status);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    submit.disabled = true;
    try {
      const res = await fetch(`/api/invitations/${token}/accept`, {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password.value }),
      });
      if (res.ok) {
        const data = (await res.json()) as { landing: string };
        await navigate(data.landing, true);
        return;
      }
      if (res.status === 410) setStatus(status, JOIN_STATUS.used);
      else if (res.status === 422) setStatus(status, JOIN_STATUS.password);
      else setStatus(status, 'Something went wrong. Try again.');
    } catch {
      setStatus(status, 'Something went wrong. Try again.');
    } finally {
      submit.disabled = false;
    }
  });
  card.append(form);
  root.append(el('div', { class: 'auth-wrap' }, card));
}
