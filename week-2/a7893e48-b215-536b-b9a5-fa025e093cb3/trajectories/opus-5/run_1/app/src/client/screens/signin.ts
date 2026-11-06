import type { SessionUser } from '../../shared/types.js';
import { api } from '../api.js';
import { landingPath, loadSites, navigate, state } from '../app.js';
import { copy } from '../copy.js';
import { el, labelled, setStatus, statusRegion } from '../dom.js';

export function signInScreen(host: HTMLElement): void {
  const email = el('input', { type: 'text', name: 'email', autocomplete: 'username', class: 'input' });
  const password = el('input', {
    type: 'password',
    name: 'password',
    autocomplete: 'current-password',
    class: 'input',
  });
  const status = statusRegion('Sign-in status');
  const submit = el('button', { type: 'submit', class: 'button primary' }, ['Sign in']);
  const form = el('form', { class: 'sign-in-card' }, [
    el('h1', {}, ['Hearthshift']),
    el('p', { class: 'sign-in-blurb' }, ['Station time for shared kitchens.']),
    labelled('Email', email),
    labelled('Password', password),
    submit,
    status,
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    setStatus(status, copy.signingIn);
    void api
      .post<{ user: SessionUser }>('/api/session', {
        email: email.value,
        password: password.value,
      })
      .then(async (result) => {
        if (!result.ok) {
          setStatus(status, copy.signInWrong);
          return;
        }
        state.user = result.data.user;
        await loadSites();
        navigate(landingPath(result.data.user));
      });
  });
  host.append(el('div', { class: 'sign-in-page' }, [form]));
  email.focus();
}
