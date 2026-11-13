import type { SessionResponse } from '../../shared/types.js';
import { send } from '../api.js';
import { copy } from '../copy.js';
import { labelledField } from '../dialog.js';
import { el, mount } from '../dom.js';
import { announce, clearProblem, failureMessage, problem } from '../live.js';
import { navigate } from '../router.js';

export function renderSignIn(options: { next: string; sessionEnded: boolean }): void {
  const email = labelledField({ label: 'Email', type: 'email' });
  const password = labelledField({ label: 'Password', type: 'password' });
  const submit = el('button', { type: 'submit', class: 'btn btn--primary' }, ['Sign in']);

  const form = el('form', { 'aria-label': 'Sign in' }, [
    email.wrapper,
    password.wrapper,
    submit,
  ]);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    clearProblem();
    announce(copy.signingIn);
    void send<SessionResponse>('/api/session', 'POST', {
      email: email.input.value,
      password: password.input.value,
    })
      .then((session) => {
        announce('');
        const first = session.memberships[0];
        navigate(options.next !== '/sign-in' ? options.next : first ? `/projects/${first.project}` : '/sign-in');
      })
      .catch((cause: unknown) => {
        announce('');
        const message = failureMessage(cause, (failure) =>
          failure.code === 'invalid_credentials' ? copy.wrongCredentials : null,
        );
        problem(message);
        password.setError(message);
      })
      .finally(() => {
        submit.disabled = false;
      });
  });

  mount(
    el('main', { class: 'signin' }, [
      el('div', { class: 'signin__panel' }, [
        el('div', { class: 'signin__brand' }, ['Keelson']),
        el('h1', {}, ['Sign in to Keelson']),
        options.sessionEnded ? el('p', { class: 'field-error' }, [copy.sessionEnded]) : null,
        form,
        el('p', { class: 'signin__note' }, ['Promotion control plane for GitOps delivery.']),
      ]),
    ]),
  );
  email.input.focus();
}
