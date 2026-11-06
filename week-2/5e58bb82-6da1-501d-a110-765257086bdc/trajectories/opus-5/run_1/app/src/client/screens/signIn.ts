import { SIGN_IN_INCORRECT } from '../../shared/copy.js';
import type { User } from '../../shared/types.js';
import { ApiFailure, NoResponse, request } from '../api.js';
import type { Mounted } from '../app.js';
import { button, clear, el, setText } from '../dom.js';
import type { Shell } from '../shell.js';

interface Options {
  next: string | null;
  reason: string | null;
  onSignedIn(user: User, home: string): void;
}

export function signInScreen(shell: Shell, options: Options): Mounted {
  const summary = el('div', { role: 'alert', tabindex: '-1', class: 'error-summary' });
  summary.hidden = true;
  const status = el('div', {
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Sign-in status',
    class: 'live-region',
  });
  shell.registerRegion('Sign-in status', status);

  const email = el('input', { type: 'email', id: 'sign-in-email', autocomplete: 'username' });
  const password = el('input', {
    type: 'password',
    id: 'sign-in-password',
    autocomplete: 'current-password',
  });
  const submit = button('Sign in', { class: 'primary' });

  function fail(message: string): void {
    clear(summary);
    summary.append(el('p', {}, [message]));
    summary.hidden = false;
    password.value = '';
    summary.focus();
  }

  if (options.reason) fail(options.reason);

  const form = el('form', { class: 'signin-card', novalidate: true }, [
    el('h1', {}, ['Sign in to Swathdeck']),
    summary,
    el('div', { class: 'field' }, [el('label', { for: 'sign-in-email' }, ['Email']), email]),
    el('div', { class: 'field' }, [el('label', { for: 'sign-in-password' }, ['Password']), password]),
    submit,
    status,
  ]);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void send();
  });
  submit.addEventListener('click', (event) => {
    event.preventDefault();
    void send();
  });

  async function send(): Promise<void> {
    summary.hidden = true;
    setText(status, 'Signing in');
    submit.disabled = true;
    try {
      const result = await request<{ user: User; home: string }>('/api/session', {
        method: 'POST',
        body: {
          email: email.value,
          password: password.value,
          ...(options.next ? { next: options.next } : {}),
        },
      });
      setText(status, '');
      shell.unregisterRegion('Sign-in status');
      options.onSignedIn(result.user, result.home);
    } catch (error) {
      setText(status, '');
      if (error instanceof ApiFailure) fail(error.body.message);
      else if (error instanceof NoResponse) fail(SIGN_IN_INCORRECT);
      else fail(SIGN_IN_INCORRECT);
    } finally {
      submit.disabled = false;
    }
  }

  return {
    node: el('section', { class: 'signin' }, [form]),
    dispose: () => shell.unregisterRegion('Sign-in status'),
  };
}
