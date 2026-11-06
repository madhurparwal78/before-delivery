import type { ScreenContext, ScreenHandle } from '../main';
import { api, RequestFailed } from '../api';
import { copy } from '../copy';
import { el, replace } from '../dom';
import { formAlert, labelledField, setFieldError } from '../ui';

function clubNameFromDocument(): string {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="paddock-club-name"]');
  return meta?.content ?? '';
}

export function renderJoin(ctx: ScreenContext): ScreenHandle {
  const slug = ctx.params.clubSlug ?? '';
  const clubName = clubNameFromDocument();
  const container = el('div', { class: 'screen screen--centered' });
  const heading = el('h1', {
    class: 'page-heading',
    text: `Join ${clubName.length > 0 ? clubName : slug}`,
  });
  const alert = formAlert();
  const name = labelledField({ label: 'Full name', id: 'join-name' });
  const email = labelledField({ label: 'Email', id: 'join-email', type: 'email' });
  const password = labelledField({
    label: 'Password',
    id: 'join-password',
    type: 'password',
    hint: 'At least 10 characters.',
  });
  const submit = el('button', {
    class: 'button button--primary',
    text: 'Create driver account',
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
          void join();
        },
      },
    },
    alert.element,
    name.wrapper,
    email.wrapper,
    password.wrapper,
    submit,
  );

  async function join(): Promise<void> {
    for (const field of [name, email, password]) setFieldError(field.input, '');
    const invalid: { message: string; focus: () => void }[] = [];
    if (name.input.value.trim().length === 0) {
      setFieldError(name.input, 'Enter your full name.');
      invalid.push({ message: 'Enter your full name.', focus: () => name.input.focus() });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.input.value.trim())) {
      setFieldError(email.input, 'Enter a valid email address.');
      invalid.push({ message: 'Enter a valid email address.', focus: () => email.input.focus() });
    }
    if (password.input.value.length < 10) {
      setFieldError(password.input, 'Use a password of at least 10 characters.');
      invalid.push({
        message: 'Use a password of at least 10 characters.',
        focus: () => password.input.focus(),
      });
    }
    if (invalid.length > 0) {
      alert.fields(invalid);
      return;
    }

    submit.disabled = true;
    submit.classList.add('is-pending');
    alert.message(copy.join.pending);
    try {
      await api.session.signUp(slug, {
        name: name.input.value.trim(),
        email: email.input.value.trim(),
        password: password.input.value,
      });
      await ctx.refreshSession();
      ctx.navigate('/events');
    } catch (error) {
      if (error instanceof RequestFailed && error.code === 'email_taken') {
        alert.message(copy.join.emailTaken);
      } else if (error instanceof RequestFailed && error.status === 422) {
        const entries = Object.entries(error.fields).map(([field, message]) => ({
          message,
          focus: () => {
            const target =
              field === 'name' ? name.input : field === 'email' ? email.input : password.input;
            target.focus();
          },
        }));
        alert.fields(entries);
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

  replace(container, heading, form);
  return { element: container };
}
