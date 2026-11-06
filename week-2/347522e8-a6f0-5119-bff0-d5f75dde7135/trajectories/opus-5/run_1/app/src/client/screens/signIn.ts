/** Sign in: a single narrow form column on the paper ground. */

import { api, ApiError } from '../api.js';
import { BRAND_NAME, PRODUCT_NAME, SIGN_IN_MISMATCH, SIGN_IN_PENDING, GENERIC_ERROR } from '../../shared/copy.js';
import { el, field } from '../dom.js';
import { replace } from '../router.js';
import { landingFor, setCurrentUser, takeSignOutFocus } from '../session.js';
import type { ScreenContext } from '../router.js';
import type { SessionUser } from '../../shared/types.js';

export function signInScreen({ root }: ScreenContext): void {
  const email = el('input', { attrs: { type: 'email', name: 'email', autocomplete: 'email' } });
  const password = el('input', {
    attrs: { type: 'password', name: 'password', autocomplete: 'current-password' },
  });
  const emailField = field('Email', email, 'signin-email');
  const passwordField = field('Password', password, 'signin-password');

  const submit = el('button', {
    class: 'btn btn--primary',
    text: 'Sign in',
    attrs: { type: 'submit' },
  });
  const status = el('p', {
    class: 'status status--alert',
    attrs: { role: 'status', 'aria-label': 'Sign-in status', 'aria-live': 'polite' },
  });

  const form = el('form', { attrs: { 'aria-label': 'Sign in', novalidate: true } }, [
    emailField.wrapper,
    passwordField.wrapper,
    submit,
    status,
    el('p', {}, [
      el('a', { text: 'Apply for kitchen time', attrs: { href: '/apply' } }),
    ]),
  ]);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit.disabled = true;
    submit.textContent = SIGN_IN_PENDING;
    status.textContent = '';
    void (async () => {
      try {
        const answer = await api.post<{ user: SessionUser }>('/api/session', {
          email: email.value,
          password: password.value,
        });
        setCurrentUser(answer.user);
        replace(landingFor(answer.user));
      } catch (error) {
        submit.disabled = false;
        submit.textContent = 'Sign in';
        status.textContent =
          error instanceof ApiError && error.status === 401 ? SIGN_IN_MISMATCH : GENERIC_ERROR;
      }
    })();
  });

  root.append(
    el('div', { class: 'main' }, [
      el('div', { class: 'narrow' }, [
        el('p', { class: 'wordmark' }, [
          el('span', { text: BRAND_NAME }),
          document.createTextNode(PRODUCT_NAME),
        ]),
        el('h1', { text: 'Sign in' }),
        form,
      ]),
    ]),
  );

  if (takeSignOutFocus()) email.focus();
}
