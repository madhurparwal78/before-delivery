import { MESSAGES } from '../../shared/errors.js';
import { RequestFailed, api } from '../api.js';
import { button, clear, el, on } from '../dom.js';

type Mode = 'signin' | 'register';

export function authScreen(root: HTMLElement, mode: Mode, navigate: (path: string) => void): void {
  clear(root);
  const page = el('main', { class: 'auth' });
  const form = el('form', { class: 'surface auth-form' });
  const username = el('input', { type: 'text', 'aria-label': 'Username', autocomplete: 'username', id: 'username' });
  const passwordLabel = el('label', { for: 'password' }, ['Password']);
  const password = el('input', { type: 'password', id: 'password', autocomplete: 'current-password' });
  const error = el('p', { class: 'form-error', role: 'alert' });
  const submit = button(mode === 'signin' ? 'Sign in' : 'Create account', { class: 'primary' });

  form.append(
    el('h1', { class: 'display' }, [mode === 'signin' ? 'Sign in' : 'Start drawing']),
    el('label', { for: 'username' }, ['Username']),
    username,
    passwordLabel,
    password,
    submit,
    error,
  );
  page.append(form);
  root.append(page);
  username.focus();

  on(form, 'submit', (event: Event) => {
    event.preventDefault();
    error.textContent = '';
    const path = mode === 'signin' ? '/api/auth/login' : '/api/auth/register';
    void api
      .post(path, { username: username.value.trim().toLowerCase(), password: password.value })
      .then(() => navigate('/folders'))
      .catch((failure: unknown) => {
        if (!(failure instanceof RequestFailed)) return;
        const fields = failure.body.fields ?? {};
        error.textContent = fields.username ?? fields.password ?? failure.body.message;
        if (failure.body.error === 'unauthenticated') error.textContent = MESSAGES.wrongCredentials;
        if (failure.body.error === 'rate_limited') error.textContent = MESSAGES.signInRateLimit;
        if (failure.body.error === 'username_taken') error.textContent = MESSAGES.usernameTaken;
      });
  });
}
