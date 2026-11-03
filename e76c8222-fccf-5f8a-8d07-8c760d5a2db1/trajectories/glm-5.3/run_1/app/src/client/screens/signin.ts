import { api, isFailure } from '../lib/api.js';
import { h, clear, statusRegion } from '../lib/dom.js';
import { copy } from '../lib/copy.js';
import { navigate, state } from '../main.js';
import type { User } from '../lib/types.js';

const LANDING: Record<User['role'], string> = {
  coordinator: '/board',
  requester: '/requests',
  interpreter: '/me',
  consumer: '/preferences',
  billing: '/billing',
};

export function renderSignIn(): HTMLElement {
  const email = h('input', { type: 'email', id: 'email' });
  const passcode = h('input', { type: 'password', id: 'passcode' });
  const emailError = h('p', { class: 'field-error', 'aria-live': 'polite' });
  const passcodeError = h('p', { class: 'field-error', 'aria-live': 'polite' });
  const status = statusRegion('Sign-in status');

  const form = h('form', { 'aria-label': 'Sign in', onsubmit: async (e: Event) => {
    e.preventDefault();
    clear(emailError); clear(passcodeError);
    let valid = true;
    if (!email.value.trim()) { emailError.textContent = 'Enter your email.'; valid = false; }
    if (!passcode.value) { passcodeError.textContent = 'Enter the passcode.'; valid = false; }
    if (!valid) return;
    status.set(copy.signIn.pending, 'pending');
    try {
      const res = await api.post<{ user: User }>('/session', { email: email.value.trim(), passcode: passcode.value });
      state.user = res.user;
      navigate(LANDING[res.user.role], true);
    } catch (err) {
      status.set(copy.signIn.error(isFailure(err) ? err : null), 'error');
    }
  } });

  form.appendChild(h('h1', {}, 'Sign in'));
  form.appendChild(h('label', { for: 'email' }, 'Email'));
  form.appendChild(email);
  form.appendChild(emailError);
  form.appendChild(h('label', { for: 'passcode' }, 'Passcode'));
  form.appendChild(passcode);
  form.appendChild(passcodeError);
  form.appendChild(h('div', { class: 'btn-row' }, h('button', { type: 'submit', class: 'primary' }, 'Sign in')));
  form.appendChild(status.el);

  return h('div', { class: 'column' }, h('div', { style: 'max-width: 420px' }, form));
}
