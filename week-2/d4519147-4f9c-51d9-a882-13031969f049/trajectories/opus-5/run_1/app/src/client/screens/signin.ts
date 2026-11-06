import { ApiFailure, api, setSession } from '../api';
import { COPY } from '../../shared/copy';
import { el, field } from '../dom';
import { isValidNext } from '../../shared/routes';
import { navigate } from '../router';
import type { SessionBody } from '../../shared/types';

export function renderSignIn(root: HTMLElement): void {
  const emailInput = el('input', { type: 'email', name: 'email', autocomplete: 'username' });
  const passwordInput = el('input', { type: 'password', name: 'password', autocomplete: 'current-password' });
  const submit = el('button', { type: 'submit', class: 'primary', text: 'Sign in' });
  const alertHost = el('div');
  const form = el('form', { novalidate: 'novalidate' }, [
    el('h1', { text: 'Scopewright' }),
    alertHost,
    field('Email', emailInput, { id: 'signin-email' }),
    field('Password', passwordInput, { id: 'signin-password' }),
    submit,
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitSignIn();
  });

  async function submitSignIn(): Promise<void> {
    submit.disabled = true;
    alertHost.replaceChildren();
    try {
      const body = await api.post<SessionBody>('/api/session', {
        email: emailInput.value,
        password: passwordInput.value,
      });
      setSession(body.user, body.csrfToken);
      const next = new URL(window.location.href).searchParams.get('next');
      await navigate(isValidNext(next) ? next : '/', { replace: true });
    } catch (error) {
      const message =
        error instanceof ApiFailure && error.code === 'signin_locked' ? COPY.signInLocked : COPY.signInFailed;
      alertHost.append(el('div', { class: 'alert', role: 'alert', text: message }));
      passwordInput.value = '';
      passwordInput.focus();
    } finally {
      submit.disabled = false;
    }
  }

  root.replaceChildren(el('div', { class: 'centred' }, [el('div', { class: 'card' }, [form])]));
  emailInput.focus();
}
