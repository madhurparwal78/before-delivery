import { ApiFailure, request } from '../api.js';
import type { User } from '../../shared/api.js';
import { homePath, loadLibrary, navigate, state, type Screen } from '../shell.js';
import { announce, element, labelledField, liveRegion, markPending, setFieldError } from '../ui/dom.js';

export function signInScreen(): Screen {
  const email = element('input', { id: 'sign-in-email', type: 'email', autocomplete: 'email' });
  const password = element('input', {
    id: 'sign-in-password',
    type: 'password',
    role: 'textbox',
    autocomplete: 'current-password',
  });
  const submit = element('button', { type: 'submit', class: 'primary' });
  submit.textContent = 'Sign in';

  const form = element('form', { class: 'box', novalidate: true }, [
    labelledField('Email', email, 'sign-in-email-error'),
    labelledField('Password', password, 'sign-in-password-error'),
    submit,
    liveRegion('Form status'),
  ]);

  form.addEventListener('submit', (event: Event) => {
    event.preventDefault();
    void signIn();
  });

  async function signIn(): Promise<void> {
    setFieldError('sign-in-email-error', 'sign-in-email', null);
    setFieldError('sign-in-password-error', 'sign-in-password', null);
    const pending = markPending(submit, 'Signing in\u2026');
    try {
      const answer = await request<{ user: User }>('/api/session', {
        method: 'POST',
        body: { email: email.value, password: password.value },
      });
      state.user = answer.user;
      state.library = null;
      await loadLibrary();
      navigate(homePath(answer.user), true);
    } catch (error) {
      pending.release();
      const failure = error instanceof ApiFailure ? error : null;
      announce('Form status', failure?.message ?? 'Email or password is wrong.');
      if (failure !== null) {
        for (const [field, copy] of Object.entries(failure.fields)) {
          if (field === 'email') setFieldError('sign-in-email-error', 'sign-in-email', copy);
          if (field === 'password') setFieldError('sign-in-password-error', 'sign-in-password', copy);
        }
      }
      email.focus();
    }
  }

  const node = element('div', { class: 'grid' }, [
    element('div', { class: 'span-6' }, [element('h1', {}, ['Sign in']), form]),
  ]);
  return { node };
}
