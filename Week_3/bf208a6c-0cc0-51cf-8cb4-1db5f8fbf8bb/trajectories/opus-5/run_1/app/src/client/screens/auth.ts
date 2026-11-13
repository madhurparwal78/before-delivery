import { AUTH_COPY } from '../../shared/copy';
import { RequestFailed, api } from '../api';
import { el, field, messageLine, on } from '../dom';

const nextPath = (): string => {
  const next = new URL(window.location.href).searchParams.get('next');
  return next !== null && next.startsWith('/') ? next : '/';
};

export const renderSignUp = (root: HTMLElement): void => {
  const name = el('input', { type: 'text', 'aria-label': 'Display name', autocomplete: 'name' });
  const email = el('input', { type: 'email', 'aria-label': 'Email', autocomplete: 'email' });
  const password = el('input', { type: 'password', 'aria-label': 'Password', autocomplete: 'new-password' });
  const nameMessage = messageLine();
  const emailMessage = messageLine();
  const passwordMessage = messageLine();
  const alert = el('p', { role: 'alert' });
  const submit = el('button', { type: 'button', text: 'Create account' });

  const column = el('div', { class: 'column' }, [
    el('h1', { text: 'Make a board' }),
    field('Display name', name, nameMessage),
    field('Email', email, emailMessage),
    field('Password', password, passwordMessage),
    submit,
    alert,
    el('p', { class: 'muted' }, [el('a', { href: '/signin', text: 'Sign in' })]),
  ]);
  root.append(column);

  const secondStep = (address: string): void => {
    const code = el('input', { type: 'text', 'aria-label': 'Code', inputmode: 'numeric', autocomplete: 'one-time-code' });
    const codeMessage = messageLine();
    const confirm = el('button', { type: 'button', text: 'Confirm email' });
    const codeAlert = el('p', { role: 'alert' });
    column.replaceChildren(
      el('h1', { text: 'Confirm your email' }),
      el('p', { text: AUTH_COPY.codeSent(address) }),
      field('Code', code, codeMessage),
      confirm,
      codeAlert,
    );
    code.focus();
    const sendCode = async (): Promise<void> => {
      codeMessage.textContent = '';
      try {
        await api.post('/api/auth/verify', { email: address, code: code.value });
        window.location.assign(nextPath());
      } catch (error) {
        if (error instanceof RequestFailed) codeMessage.textContent = error.fieldError('code') ?? AUTH_COPY.badCode;
      }
    };
    on(confirm, 'click', () => void sendCode());
    on(code, 'keydown', (event) => {
      if (event.key === 'Enter') void sendCode();
    });
  };

  const create = async (): Promise<void> => {
    nameMessage.textContent = '';
    emailMessage.textContent = '';
    passwordMessage.textContent = '';
    alert.textContent = '';
    try {
      await api.post('/api/auth/signup', {
        display_name: name.value,
        email: email.value,
        password: password.value,
      });
      secondStep(email.value.trim().toLowerCase());
    } catch (error) {
      if (!(error instanceof RequestFailed)) throw error;
      if (error.code === 'mail_unavailable') {
        alert.textContent = AUTH_COPY.mailDown;
        return;
      }
      nameMessage.textContent = error.fieldError('display_name') ?? '';
      emailMessage.textContent = error.fieldError('email') ?? '';
      passwordMessage.textContent = error.fieldError('password') ?? '';
    }
  };

  on(submit, 'click', () => void create());
  for (const input of [name, email, password]) {
    on(input, 'keydown', (event) => {
      if (event.key === 'Enter') void create();
    });
  }
  name.focus();
};

export const renderSignIn = (root: HTMLElement): void => {
  const email = el('input', { type: 'email', 'aria-label': 'Email', autocomplete: 'email' });
  const password = el('input', { type: 'password', 'aria-label': 'Password', autocomplete: 'current-password' });
  const emailMessage = messageLine();
  const alert = el('p', { role: 'alert' });
  const submit = el('button', { type: 'button', text: 'Sign in' });

  root.append(
    el('div', { class: 'column' }, [
      el('h1', { text: 'Sign in' }),
      field('Email', email, emailMessage),
      field('Password', password),
      submit,
      alert,
      el('p', { class: 'muted' }, [el('a', { href: '/signup', text: 'Create account' })]),
    ]),
  );

  const signIn = async (): Promise<void> => {
    alert.textContent = '';
    emailMessage.textContent = '';
    try {
      await api.post('/api/auth/signin', { email: email.value, password: password.value });
      window.location.assign(nextPath());
    } catch (error) {
      if (!(error instanceof RequestFailed)) throw error;
      if (error.code === 'unconfirmed') alert.textContent = AUTH_COPY.unconfirmed;
      else if (error.code === 'wrong_credentials') alert.textContent = AUTH_COPY.badCredentials;
      else emailMessage.textContent = error.fieldError('email') ?? AUTH_COPY.badCredentials;
    }
  };

  on(submit, 'click', () => void signIn());
  for (const input of [email, password]) {
    on(input, 'keydown', (event) => {
      if (event.key === 'Enter') void signIn();
    });
  }
  email.focus();
};
