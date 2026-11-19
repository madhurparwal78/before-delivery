import { postJson, serverText, type ApiErrorBody } from '../api.js';
import { COPY } from '../copy.js';
import { button, el, navigate, passcodeField, setStatus, textField } from '../dom.js';
import { openDialog } from '../ui/dialog.js';
import type { Page, PageContext } from '../main.js';

export async function renderSignIn(context: PageContext): Promise<Page> {
  const email = textField('Email');
  email.input.type = 'email';
  email.input.autocomplete = 'email';
  const passcode = passcodeField('Passcode');
  const signIn = button('Sign in', { class: 'primary' });
  const createAccount = button('Create an owner account');

  const submit = async (): Promise<void> => {
    setStatus(context.feedback, COPY.signingIn);
    const result = await postJson<ApiErrorBody>('/api/session', {
      email: email.input.value,
      passcode: passcode.input.value,
    });
    if (result.ok) {
      navigate('/');
      return;
    }
    if (result.status === 401) {
      setStatus(context.feedback, COPY.badCredentials);
      email.input.setAttribute('aria-invalid', 'true');
      return;
    }
    if (result.status === 422) {
      setStatus(context.feedback, serverText(result.body));
      return;
    }
    setStatus(context.feedback, COPY.somethingWrong);
  };

  signIn.addEventListener('click', () => {
    void submit();
  });
  for (const input of [email.input, passcode.input]) {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void submit();
      }
    });
  }

  createAccount.addEventListener('click', () => {
    const name = textField('Your name');
    const newEmail = textField('Email');
    newEmail.input.type = 'email';
    const newPasscode = passcodeField('Passcode');
    newPasscode.input.autocomplete = 'new-password';
    openDialog({
      title: 'Create an owner account',
      content: [name.wrapper, newEmail.wrapper, newPasscode.wrapper],
      submitLabel: 'Create account',
      onSubmit: async () => {
        setStatus(context.feedback, COPY.signingIn);
        const result = await postJson<ApiErrorBody>('/api/owners', {
          name: name.input.value,
          email: newEmail.input.value,
          passcode: newPasscode.input.value,
        });
        if (result.ok) {
          navigate('/');
          return;
        }
        if (result.status === 409) {
          setStatus(context.feedback, COPY.emailTaken);
          return;
        }
        if (result.status === 422) {
          setStatus(context.feedback, serverText(result.body));
          return;
        }
        setStatus(context.feedback, COPY.somethingWrong);
      },
    });
  });

  const element = el('div', { class: 'page sign-in' }, [
    el('h1', { text: 'Sixbell Rest Log' }),
    el('p', {
      class: 'lede',
      text: 'Hours of rest, logged as they happen and judged on elapsed time.',
    }),
    el('div', { class: 'card' }, [email.wrapper, passcode.wrapper, el('div', { class: 'actions' }, [signIn, createAccount])]),
  ]);
  return { element };
}
