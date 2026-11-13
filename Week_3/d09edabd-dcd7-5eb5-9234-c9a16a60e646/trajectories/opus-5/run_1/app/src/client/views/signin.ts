import { request } from '../api.js';
import { copy } from '../../shared/copy.js';
import { el, field } from '../dom.js';

export function signInView(root: HTMLElement, go: (path: string) => void): void {
  document.body.className = 'scrolls';
  const email = el('input', { type: 'email', 'aria-label': 'Email', autocomplete: 'email' });
  const password = el('input', {
    type: 'password',
    'aria-label': 'Password',
    autocomplete: 'current-password',
  });
  const problem = el('p', { class: 'field-error', role: 'alert' });
  const form = el('form', { 'aria-label': 'Sign in', class: 'signup-sheet' }, [
    el('h1', { text: 'Sign in' }),
    field('Email', email),
    field('Password', password),
    problem,
    el('button', { type: 'submit', class: 'primary', text: 'Sign in' }),
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    problem.textContent = '';
    void request<unknown>('POST', '/api/auth/login', {
      body: { email: email.value, password: password.value },
    })
      .then(() => go('/app'))
      .catch(() => {
        problem.textContent = copy.signInFailure;
      });
  });
  root.append(el('div', { class: 'pack-column' }, [form]));
  email.focus();
}
