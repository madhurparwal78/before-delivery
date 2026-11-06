import type { ScreenContext, ScreenHandle } from '../main';
import { api, RequestFailed } from '../api';
import { copy } from '../copy';
import { el } from '../dom';
import { formAlert, labelledField, setFieldError } from '../ui';

export function renderSignIn(ctx: ScreenContext): ScreenHandle {
  const alert = formAlert();
  const email = labelledField({ label: 'Email', id: 'signin-email', type: 'email' });
  const password = labelledField({ label: 'Password', id: 'signin-password', type: 'password' });
  const submit = el('button', {
    class: 'button button--primary',
    text: 'Sign in',
    attrs: { type: 'submit' },
  });

  const form = el(
    'form',
    {
      class: 'form form--narrow',
      attrs: { novalidate: 'novalidate' },
      on: {
        submit: (event: SubmitEvent) => {
          event.preventDefault();
          void signIn();
        },
      },
    },
    alert.element,
    email.wrapper,
    password.wrapper,
    submit,
  );

  async function signIn(): Promise<void> {
    setFieldError(email.input, '');
    setFieldError(password.input, '');
    const invalid: { message: string; focus: () => void }[] = [];
    if (email.input.value.trim().length === 0) {
      setFieldError(email.input, 'Enter your email address.');
      invalid.push({ message: 'Enter your email address.', focus: () => email.input.focus() });
    }
    if (password.input.value.length === 0) {
      setFieldError(password.input, 'Enter your password.');
      invalid.push({ message: 'Enter your password.', focus: () => password.input.focus() });
    }
    if (invalid.length > 0) {
      alert.fields(invalid);
      return;
    }

    submit.disabled = true;
    submit.classList.add('is-pending');
    alert.message(copy.signIn.pending);
    try {
      const result = await api.session.signIn(email.input.value.trim(), password.input.value);
      await ctx.refreshSession();
      ctx.navigate(result.user.roles.includes('operator') ? '/operator' : '/events');
    } catch (error) {
      if (error instanceof RequestFailed && error.status === 401) {
        alert.message(copy.signIn.invalid);
      } else if (error instanceof RequestFailed) {
        alert.message(error.message);
      } else {
        throw error;
      }
    } finally {
      submit.disabled = false;
      submit.classList.remove('is-pending');
    }
  }

  return {
    element: el(
      'div',
      { class: 'screen screen--centered' },
      el('h1', { class: 'page-heading', text: 'Sign in to Conecount Paddock' }),
      form,
    ),
  };
}
