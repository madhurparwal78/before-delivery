import { api, ApiCallError } from '../api.ts';
import { h } from '../dom.ts';
import { navigate, safeReturnPath } from '../router.ts';
import { GENERIC_ERROR, SIGN_IN_ERROR } from '../../shared/copy.ts';

export const signInScreen = (): HTMLElement => {
  const next = safeReturnPath(new URLSearchParams(window.location.search).get('next'));
  const email = h('input', { type: 'email', id: 'sign-in-email', autocomplete: 'username' });
  const password = h('input', {
    type: 'password',
    id: 'sign-in-password',
    autocomplete: 'current-password',
  });
  const error = h('p', { class: 'field-error', role: 'alert' });
  const submit = h('button', { type: 'submit', class: 'button' }, 'Sign in');

  const form = h(
    'form',
    { class: 'sign-in-form' },
    h('h1', { class: 'page-heading' }, 'Undersign'),
    h('label', { for: 'sign-in-email' }, 'Email'),
    email,
    h('label', { for: 'sign-in-password' }, 'Password'),
    password,
    error,
    submit,
  );

  form.addEventListener('submit', (event: Event) => {
    event.preventDefault();
    error.textContent = '';
    void (async () => {
      try {
        await api.signIn(email.value.trim(), password.value);
        navigate(next);
      } catch (failure) {
        error.textContent =
          failure instanceof ApiCallError && failure.failure.status === 401
            ? SIGN_IN_ERROR
            : GENERIC_ERROR;
      }
    })();
  });

  return h('div', { class: 'sign-in-page' }, form);
};
