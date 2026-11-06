import { ApiFailure, Member, api } from '../api';
import { clear, el } from '../dom';

export function mountSignIn(onSignedIn: () => void): void {
  clear(document.body);
  const email = el('input', { type: 'email', class: 'control', id: 'signin-email', autocomplete: 'username' });
  const passcode = el('input', {
    type: 'password',
    class: 'control',
    id: 'signin-passcode',
    autocomplete: 'current-password',
  });
  const button = el('button', { type: 'submit', class: 'primary', text: 'Sign in' });
  const alerts = el('div', { class: 'alerts', role: 'alert' });
  const form = el('form', { class: 'signin-form', 'aria-label': 'Sign in' }, [
    el('h1', { class: 'signin-title', text: 'Sign in to Dispatch' }),
    el('div', { class: 'field' }, [
      el('label', { class: 'field-label', for: 'signin-email', text: 'Email' }),
      email,
    ]),
    el('div', { class: 'field' }, [
      el('label', { class: 'field-label', for: 'signin-passcode', text: 'Passcode' }),
      passcode,
    ]),
    button,
    alerts,
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    alerts.textContent = '';
    button.disabled = true;
    button.textContent = 'Signing in…';
    void api
      .post<{ member: Member }>('/api/session', { email: email.value, passcode: passcode.value })
      .then(() => onSignedIn())
      .catch((error: unknown) => {
        if (!(error instanceof ApiFailure)) throw error;
        alerts.textContent = 'That email and passcode do not match.';
      })
      .finally(() => {
        button.disabled = false;
        button.textContent = 'Sign in';
      });
  });
  document.body.append(el('div', { class: 'signin-page' }, [form]));
  email.focus();
}
