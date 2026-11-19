import { type ApiErrorBody, fieldErrors, generalMessage, retryAfterOf, send } from '../api.js';
import { el } from '../dom.js';
import { connectEvents } from '../events.js';
import { loadMe, type Me } from '../session.js';
import { navigate, refreshHeader } from '../shell.js';

export function signinPage(host: HTMLElement, _params: Record<string, string>, query: URLSearchParams): void {
  document.body.dataset.field = 'ground';
  const next = query.get('next') ?? '/workbooks';
  const username = el('input', { type: 'text', id: 'username', class: 'input' });
  const password = el('input', { type: 'password', id: 'password', class: 'input' });
  const status = el('p', { role: 'status', 'aria-live': 'polite', 'aria-label': 'Sign-in state', class: 'status' });
  const usernameError = el('p', { class: 'field-error' });
  const passwordError = el('p', { class: 'field-error' });

  const submit = async (path: string): Promise<void> => {
    usernameError.textContent = '';
    passwordError.textContent = '';
    status.textContent = '';
    const res = await send<Me & ApiErrorBody>('POST', path, {
      username: username.value,
      password: password.value,
    });
    if (res.status === 200 || res.status === 201) {
      await loadMe();
      refreshHeader();
      connectEvents();
      navigate(next);
      return;
    }
    if (res.status === 401) {
      status.textContent = 'Wrong username or password.';
      return;
    }
    if (res.status === 429) {
      status.textContent = `Too many sign-in attempts. Try again in ${retryAfterOf(res)} seconds.`;
      return;
    }
    const errors = fieldErrors(res.data);
    if (errors.username !== undefined) {
      usernameError.textContent = errors.username;
      status.textContent = errors.username;
    }
    if (errors.password !== undefined) {
      passwordError.textContent = errors.password;
      status.textContent = errors.password;
    }
    const general = generalMessage(res);
    if (status.textContent === '' && general !== null) status.textContent = general;
  };

  const signIn = el('button', { type: 'submit', class: 'pill-button primary', text: 'Sign in' });
  const create = el('button', { type: 'button', class: 'pill-button', text: 'Create account' });
  signIn.addEventListener('click', (event) => {
    event.preventDefault();
    void submit('/api/auth/login');
  });
  create.addEventListener('click', () => {
    void submit('/api/auth/register');
  });

  const form = el('form', { class: 'card signin-card' }, [
    el('h1', { text: 'Sign in' }),
    el('label', { for: 'username', text: 'Username' }),
    username,
    usernameError,
    el('label', { for: 'password', text: 'Password' }),
    password,
    passwordError,
    el('div', { class: 'row' }, [signIn, create]),
    status,
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit('/api/auth/login');
  });
  host.append(form);
}
