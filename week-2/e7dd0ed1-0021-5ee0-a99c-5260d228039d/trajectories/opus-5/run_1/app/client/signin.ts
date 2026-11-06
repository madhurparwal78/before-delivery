import { ApiFailure, api } from './api';
import { button, el, field, replace, textbox } from './dom';
import { signIn as signInCopy, storageOutage } from './copy';
import type { Identity } from './types';

function landing(identity: Identity): string {
  const next = new URLSearchParams(window.location.search).get('next');
  if (next !== null && next.startsWith('/')) {
    const operatorPath = next.startsWith('/ops');
    if (identity.user.operator === operatorPath || next.startsWith('/account')) return next;
  }
  return identity.user.operator ? '/ops' : '/console';
}

export async function mountSignIn(root: HTMLElement): Promise<void> {
  const alert = el('p', { class: 'alert', role: 'alert' });
  let pending = false;
  try {
    const identity = await api.get<Identity>('/api/me');
    window.location.replace(landing(identity.body));
    return;
  } catch (error) {
    if (error instanceof ApiFailure && error.code === 'two_step_required') pending = true;
  }

  function finish(identity: Identity): void {
    window.location.replace(landing(identity));
  }

  function passwordStep(): void {
    const email = textbox('Email', { type: 'email' });
    const password = textbox('Password', { type: 'password' });
    const submit = button('Sign in', { className: 'primary' });
    submit.addEventListener('click', async () => {
      alert.textContent = '';
      submit.textContent = 'Signing in\u2026';
      submit.disabled = true;
      try {
        const response = await api.post<Identity | { two_step: string }>('/api/session', {
          email: email.value.trim(),
          password: password.value,
        });
        if (response.status === 202) {
          codeStep();
          return;
        }
        finish(response.body as Identity);
      } catch (error) {
        submit.textContent = 'Sign in';
        submit.disabled = false;
        if (!(error instanceof ApiFailure)) throw error;
        alert.textContent =
          error.code === 'rate_limited'
            ? signInCopy.throttled(error.retryAfterSeconds)
            : error.code === 'invalid_credentials'
              ? signInCopy.wrong
              : error.code === 'service_unavailable' || error.code === 'storage_unavailable'
                ? storageOutage
                : error.message;
      }
    });
    const form = el('div', { class: 'panel' }, [
      el('h1', { text: 'Sign in to Farshore' }),
      field('Email', email),
      field('Password', password),
      submit,
      alert,
    ]);
    for (const input of [email, password]) {
      input.addEventListener('keydown', (event) => {
        if ((event as KeyboardEvent).key === 'Enter') submit.click();
      });
    }
    replace(root, [form]);
    email.focus();
  }

  function codeStep(recovery = false): void {
    const input = textbox(recovery ? 'Recovery code' : 'Authenticator code');
    input.setAttribute('autocomplete', 'one-time-code');
    const verify = button('Verify', { className: 'primary' });
    const swap = button(recovery ? 'Use an authenticator code' : 'Use a recovery code', {
      onClick: () => codeStep(!recovery),
    });
    verify.addEventListener('click', async () => {
      alert.textContent = '';
      verify.textContent = 'Verifying\u2026';
      verify.disabled = true;
      try {
        const body = recovery ? { recovery_code: input.value.trim() } : { code: input.value.trim() };
        const response = await api.post<Identity>('/api/session/two-step', body);
        finish(response.body);
      } catch (error) {
        verify.textContent = 'Verify';
        verify.disabled = false;
        if (!(error instanceof ApiFailure)) throw error;
        if (error.code === 'unauthenticated') {
          alert.textContent = signInCopy.expired;
          passwordStep();
          const region = root.querySelector('.alert');
          if (region) region.textContent = signInCopy.expired;
          return;
        }
        alert.textContent =
          error.code === 'rate_limited'
            ? signInCopy.throttled(error.retryAfterSeconds)
            : error.code === 'validation_failed'
              ? (error.errors.code ?? signInCopy.wrongCode)
              : signInCopy.wrongCode;
      }
    });
    input.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') verify.click();
    });
    replace(root, [
      el('div', { class: 'panel' }, [
        el('h1', { text: recovery ? 'Enter one of your recovery codes' : 'Enter the code from your authenticator app' }),
        recovery ? null : el('p', { class: 'hint', text: 'Codes change every 30 seconds.' }),
        field(recovery ? 'Recovery code' : 'Authenticator code', input),
        verify,
        swap,
        alert,
      ]),
    ]);
    input.focus();
  }

  if (pending) codeStep();
  else passwordStep();
}
