import { copy } from '../../shared/copy.js';
import { api, RequestFailed } from '../api.js';
import { el, on } from '../dom.js';
import { navigate } from '../router.js';
import { resetScreen } from '../shell.js';

interface Fields {
  username: HTMLInputElement;
  password: HTMLInputElement;
}

function field(
  label: string,
  type: string,
  autocomplete: string,
): { wrap: HTMLElement; input: HTMLInputElement; error: HTMLElement } {
  const id = `field-${label.toLowerCase()}`;
  const input = el('input', { id, type, autocomplete, 'aria-describedby': `${id}-error` });
  const error = el('p', { id: `${id}-error`, class: 'field-error' });
  const wrap = el('div', { class: 'field' }, [
    el('label', { for: id, text: label }),
    input,
    error,
  ]);
  return { wrap, input, error };
}

function form(mode: 'signup' | 'signin'): void {
  const root = resetScreen();
  document.title = mode === 'signup' ? 'Create an account' : 'Sign in';
  const username = field('Username', 'text', 'username');
  const password = field('Password', 'password', mode === 'signup' ? 'new-password' : 'current-password');
  const formError = el('p', { class: 'form-error', role: 'alert' });
  const submit = el('button', {
    type: 'submit',
    class: 'primary',
    text: mode === 'signup' ? 'Create account' : 'Sign in',
  });
  const node = el('form', { class: 'account-form', novalidate: true }, [
    el('h1', { text: mode === 'signup' ? 'Create your account' : 'Sign in to Sprigmap' }),
    formError,
    username.wrap,
    password.wrap,
    submit,
    el('p', { class: 'form-switch' }, [
      mode === 'signup'
        ? el('a', { href: '/signin', text: 'I already have an account' })
        : el('a', { href: '/signup', text: 'Create an account instead' }),
    ]),
  ]);
  const fields: Fields = { username: username.input, password: password.input };
  on(node, 'submit', (event) => {
    event.preventDefault();
    username.error.textContent = '';
    password.error.textContent = '';
    formError.textContent = '';
    void api
      .post(mode === 'signup' ? '/api/auth/signup' : '/api/auth/login', {
        username: fields.username.value,
        password: fields.password.value,
      })
      .then(() => navigate('/maps'))
      .catch((error: unknown) => {
        if (!(error instanceof RequestFailed)) throw error;
        const body = error.body;
        if (body.fields?.username) username.error.textContent = body.fields.username;
        if (body.fields?.password) password.error.textContent = body.fields.password;
        if (body.error === 'username_taken') formError.textContent = copy.usernameTaken;
        else if (body.error === 'bad_credentials') formError.textContent = copy.wrongCredentials;
        else if (body.error === 'rate_limited') formError.textContent = copy.rateLimited;
        else if (!body.fields) formError.textContent = body.message;
      });
  });
  root.append(
    el('header', { class: 'top-bar', role: 'banner' }, [
      el('a', { href: '/', class: 'logo', 'aria-label': 'Sprigmap' }, [
        el('span', { class: 'logo-mark', 'aria-hidden': 'true' }),
        el('span', { text: 'Sprigmap' }),
      ]),
    ]),
    el('main', { class: 'account-main' }, [node]),
  );
}

export function signupScreen(): void {
  form('signup');
}

export function signinScreen(): void {
  form('signin');
}
