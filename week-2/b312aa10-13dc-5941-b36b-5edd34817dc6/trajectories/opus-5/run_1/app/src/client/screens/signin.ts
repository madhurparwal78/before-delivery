import { ApiError, NetworkError, networkCopy, post } from '../api.js';
import { el, fieldError, labelled, on, setFieldError } from '../dom.js';
import type { ScreenContext } from '../screen.js';
import type { SessionInfo } from '../shell.js';

export function signInScreen(context: ScreenContext): { element: HTMLElement } {
  const email = el('input', { type: 'email', name: 'email', autocomplete: 'username' });
  const password = el('input', {
    type: 'password',
    name: 'password',
    autocomplete: 'current-password',
  });
  const emailError = fieldError();
  const passwordError = fieldError();
  const submit = el('button', { type: 'submit', text: 'Sign in' });

  const form = el('form', { class: 'signin-panel' }, [
    el('h1', { text: 'Lineboard', class: 'display' }),
    labelled('Email', email, emailError),
    labelled('Password', password, passwordError),
    submit,
  ]);

  on(form, 'submit', (event) => {
    event.preventDefault();
    void attempt();
  });

  async function attempt(): Promise<void> {
    setFieldError(email, emailError, null);
    setFieldError(password, passwordError, null);
    context.clearAlert();
    submit.setAttribute('disabled', '');
    submit.setAttribute('aria-busy', 'true');
    context.announce('Signing in…');
    try {
      const result = await post<SessionInfo>('/api/session', {
        email: email.value,
        password: password.value,
      });
      context.onSignedIn(result.body);
    } catch (error) {
      password.value = '';
      if (error instanceof ApiError) {
        if (error.status === 422) {
          const errors = error.fieldErrors();
          if (errors['email']) setFieldError(email, emailError, errors['email']);
          if (errors['password']) setFieldError(password, passwordError, errors['password']);
          context.showAlert(error.copy);
        } else {
          context.showAlert(error.copy);
        }
      } else if (error instanceof NetworkError) {
        context.showAlert(networkCopy);
      }
      context.announce('');
      email.focus();
    } finally {
      submit.removeAttribute('disabled');
      submit.removeAttribute('aria-busy');
    }
  }

  return { element: el('div', { class: 'signin-screen' }, form) };
}
