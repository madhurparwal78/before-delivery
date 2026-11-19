import { ApiRequest, errorText } from './api.js';
import { el, status } from './ui.js';
import type { SessionUser } from './types.js';

export function renderSignIn(root: HTMLElement, onSignedIn: (user: SessionUser) => void): void {
  const statusNode = status('');
  const emailInput = el('input', { type: 'text', 'aria-label': 'Email' }) as HTMLInputElement;
  const passwordInput = el('input', { type: 'password', 'aria-label': 'Password' }) as HTMLInputElement;
  const form = el('form', { class: 'sign-in' },
    el('h1', { text: 'Nightroll' }),
    el('div', { class: 'form-row' }, el('label', { text: 'Email' }), emailInput),
    el('div', { class: 'form-row' }, el('label', { text: 'Password' }), passwordInput),
    el('button', { type: 'submit', text: 'Sign in', class: 'primary' }),
    statusNode
  );
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    statusNode.setAttribute('role', 'status');
    statusNode.textContent = 'Signing in…';
    const res = await ApiRequest.post('/api/session', { email: emailInput.value, password: passwordInput.value });
    if (res.status === 200) {
      onSignedIn(res.data.user as SessionUser);
    } else {
      statusNode.textContent = errorText(res.data) ?? 'That email or password is not right.';
    }
  });
  root.replaceChildren(form);
}
