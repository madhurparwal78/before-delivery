import { api, el, type Address, type OrderView, type SubscriptionView, type User } from '../api.js';

export function renderSignIn(): void {
  const main = el('main', { class: 'page narrow' });
  main.append(el('h1', { text: 'Sign in' }));
  const email = el('input', { type: 'email', 'aria-label': 'Email', class: 'field-row' });
  const password = el('input', { type: 'password', 'aria-label': 'Password', class: 'field-row' });
  const submit = el('button', { class: 'btn btn-primary', text: 'Sign in' });
  const status = el('p', { role: 'status', 'aria-live': 'polite', 'data-region': 'account-status' });
  const doSignIn = async (): Promise<void> => {
    try {
      await api('/api/auth/sign-in', { json: { email: email.value.trim(), password: password.value } });
      const next = new URLSearchParams(window.location.search).get('next');
      window.history.pushState({}, '', next ?? '/account');
      const { renderRoute } = await import('../app.js');
      await renderRoute();
    } catch (e) {
      const err = e as { status?: number; body?: { error?: string; message?: string } };
      status.textContent =
        err.body?.error === 'invalid_credentials'
          ? "That email and password don't match."
          : err.body?.error === 'accounts_unavailable'
          ? 'Sign-in is unavailable right now. Your crate is still held.'
          : 'Sign-in failed. Try again.';
    }
  };
  submit.addEventListener('click', () => void doSignIn());
  const form = el('form', {});
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void doSignIn();
  });
  form.append(
    el('div', { class: 'field-row' }, el('label', { text: 'Email' }), email),
    el('div', { class: 'field-row' }, el('label', { text: 'Password' }), password),
    submit,
    status,
    el('p', {}, el('a', { href: '/sign-up', text: 'Create an account' }))
  );
  main.append(form);
  document.getElementById('app')!.append(main);
  email.focus();
}

export function renderSignUp(): void {
  const main = el('main', { class: 'page narrow' });
  main.append(el('h1', { text: 'Create your account' }));
  const email = el('input', { type: 'email', 'aria-label': 'Email', class: 'field-row' });
  const name = el('input', { type: 'text', 'aria-label': 'Name', class: 'field-row' });
  const password = el('input', { type: 'password', 'aria-label': 'Password', class: 'field-row' });
  const submit = el('button', { class: 'btn btn-primary', text: 'Create account' });
  const status = el('p', { role: 'status', 'aria-live': 'polite', 'data-region': 'account-status' });
  const doSignUp = async (): Promise<void> => {
    try {
      await api('/api/auth/sign-up', {
        json: { email: email.value.trim(), password: password.value, name: name.value.trim() },
      });
      window.history.pushState({}, '', '/account');
      const { renderRoute } = await import('../app.js');
      await renderRoute();
    } catch (e) {
      const err = e as { status?: number; body?: { error?: string; message?: string } };
      status.textContent =
        err.body?.error === 'email_taken'
          ? 'An account with that email already exists.'
          : err.body?.error === 'accounts_unavailable'
          ? 'Sign-in is unavailable right now. Your crate is still held.'
          : 'Sign-up failed. Try again.';
    }
  };
  submit.addEventListener('click', () => void doSignUp());
  const form = el('form', {});
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void doSignUp();
  });
  form.append(
    el('div', { class: 'field-row' }, el('label', { text: 'Email' }), email),
    el('div', { class: 'field-row' }, el('label', { text: 'Name' }), name),
    el('div', { class: 'field-row' }, el('label', { text: 'Password' }), password),
    submit,
    status
  );
  main.append(form);
  document.getElementById('app')!.append(main);
  email.focus();
}

export { renderAccount, renderSubscriptionPath } from './account.js';
export type { Address, OrderView, SubscriptionView, User };
