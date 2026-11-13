import { isReturnPathAllowed, matchRoute, ROLE_HOME } from '../../domain/routes.ts';
import { api } from '../api.ts';
import { copy } from '../copy.ts';
import { el, setText } from '../dom.ts';
import { navigate } from '../navigation.ts';
import type { Screen } from '../screen.ts';
import { refreshUser, requestDraftRestore, requireUser } from '../session.ts';

/** Sign in: one narrow form, centred at every viewport. */

export async function signInScreen(): Promise<Screen> {
  const status = el('p', {
    class: 'status',
    attrs: { role: 'status', 'aria-label': 'Sign-in status', 'aria-live': 'polite' },
  });

  const email = el('input', {
    class: 'input',
    attrs: { type: 'email', id: 'sign-in-email', autocomplete: 'username', required: true },
  });
  const password = el('input', {
    class: 'input',
    attrs: { type: 'password', id: 'sign-in-password', autocomplete: 'current-password', required: true },
  });
  const submit = el('button', { class: 'button', text: 'Sign in', attrs: { type: 'submit' } });

  const form = el('form', {
    class: 'card form',
    attrs: { 'aria-label': 'Sign in', novalidate: true },
    children: [
      el('label', { class: 'label', text: 'Email', attrs: { for: 'sign-in-email' } }),
      email,
      el('label', { class: 'label', text: 'Password', attrs: { for: 'sign-in-password' } }),
      password,
      submit,
      status,
    ],
  });

  email.setAttribute('aria-label', 'Email');

  let pending = false;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (pending) return;
    pending = true;
    setText(status, copy.signingIn);
    void (async () => {
      try {
        await api.post('/api/session', { email: email.value, password: password.value });
        await refreshUser();
        navigate(destination());
      } catch {
        pending = false;
        setText(status, copy.badCredentials);
      }
    })();
  });

  return {
    element: el('main', {
      class: 'page page-centred',
      children: [el('h1', { text: copy.signInHeading }), form],
    }),
  };
}

/** A return path is followed only when it belongs to the signed-in role. */
function destination(): string {
  const user = requireUser();
  const returnPath = new URLSearchParams(window.location.search).get('return');
  if (returnPath !== null && isReturnPathAllowed(returnPath, user.role)) {
    const pathname = returnPath.split('?')[0] as string;
    if (matchRoute(pathname)?.name === 'order-new') requestDraftRestore();
    return returnPath;
  }
  return ROLE_HOME[user.role];
}
