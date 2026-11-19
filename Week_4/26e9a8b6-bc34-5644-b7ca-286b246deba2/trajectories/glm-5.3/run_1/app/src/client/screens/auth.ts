// Sign-in, sign-up and confirm screens: single-column forms of adjoining cells.

import { el, announce } from '../dom';
import { api } from '../api';
import { COPY } from '../../shared/copy';
import { safeReturnPath } from '../dom';

function accountShell(main: HTMLElement, heading: string): { form: HTMLElement; accountStatus: HTMLElement } {
  main.textContent = '';
  const column = el('div', { class: 'auth-column' });
  column.append(el('h1', { class: 'display' }, heading));
  const form = el('form', { class: 'pw-form', 'aria-label': heading });
  const accountStatus = el('div', { role: 'status', 'aria-live': 'polite', 'data-status': 'account' });
  column.append(form, accountStatus);
  main.append(column);
  return { form, accountStatus };
}

function field(form: HTMLElement, label: string, type: string, name: string): HTMLInputElement {
  const wrap = el('div', { class: 'pw-field' });
  const id = `field-${name}`;
  const input = el('input', { type, id, name, 'aria-label': label }) as HTMLInputElement;
  const labelNode = el('label', { for: id }, label);
  wrap.append(labelNode, input);
  form.append(wrap);
  return input;
}

export function renderSignIn(main: HTMLElement): void {
  const { form, accountStatus } = accountShell(main, 'Sign in');
  const email = field(form, 'Email', 'email', 'email');
  const password = field(form, 'Password', 'password', 'password');
  const submit = el('button', { class: 'pw-btn', type: 'submit' }, 'Sign in');
  form.append(submit);
  const create = el('a', { href: '/signup' }, 'Create an account');
  form.append(create);

  const next = new URLSearchParams(window.location.search).get('next');
  const returnTo = next ? safeReturnPath(next) : '/dashboard';

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('/api/session', { body: { email: email.value, password: password.value } });
      window.location.href = returnTo;
    } catch (error) {
      const err = error as { status?: number; code?: string; body?: Record<string, unknown> };
      if (err.code === 'rate_limited') {
        accountStatus.textContent = COPY.account.signInLimited(Number(err.body?.retry_after ?? 0));
        return;
      }
      accountStatus.textContent = COPY.account.badSignIn;
    }
  });
}

export function renderSignUp(main: HTMLElement): void {
  const { form, accountStatus } = accountShell(main, 'Sign up');
  const name = field(form, 'Name', 'text', 'name');
  const email = field(form, 'Email', 'email', 'email');
  const password = field(form, 'Password', 'password', 'password');
  const submit = el('button', { class: 'pw-btn', type: 'submit' }, 'Sign up');
  form.append(submit);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const result = await api<{ user: { email: string }; message_sent: boolean }>('/api/accounts', {
        body: { name: name.value, email: email.value, password: password.value },
      });
      if (result.message_sent) {
        window.location.href = '/confirm';
      } else {
        window.location.href = '/confirm?mail=failed';
      }
    } catch (error) {
      const err = error as { code?: string };
      accountStatus.textContent = err.code === 'email_taken' ? COPY.account.emailTaken : COPY.account.mailFailed;
    }
  });
}

export function renderConfirm(main: HTMLElement): void {
  main.textContent = '';
  const column = el('div', { class: 'auth-column' });
  column.append(el('h1', { class: 'display' }, 'Confirm your email'));
  const accountStatus = el('div', { role: 'status', 'aria-live': 'polite', 'data-status': 'account' });
  const resend = el('button', { class: 'pw-btn' }, 'Send a new link');
  column.append(accountStatus, resend);
  main.append(column);

  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');

  const checkSession = async (): Promise<void> => {
    try {
      const session = await api<{ user: { id: string; name: string; email: string; confirmed: boolean } }>('/api/session');
      if (session.user.confirmed) {
        accountStatus.textContent = COPY.account.confirmed;
        resend.remove();
        return;
      }
      // A signed-in unconfirmed person sees the waiting screen only after SMTP accepted.
      if (params.get('mail') === 'failed') {
        accountStatus.textContent = COPY.account.mailFailed;
      } else {
        accountStatus.textContent = COPY.account.waiting(session.user.email);
      }
    } catch {
      // Signed out: the waiting screen makes no claim about a message.
      accountStatus.textContent = '';
    }
  };

  if (token) {
    // Opening the link from the message confirms without a session.
    api('/api/account/confirm', { body: { token } })
      .then(() => {
        accountStatus.textContent = COPY.account.confirmed;
      })
      .catch(() => {
        accountStatus.textContent = COPY.account.badToken;
      });
  } else {
    void checkSession();
  }

  resend.addEventListener('click', async () => {
    try {
      await api('/api/session');
      const result = await api<{ sent: boolean }>('/api/account/resend', { body: {} });
      const session = await api<{ user: { email: string } }>('/api/session');
      announce('account', COPY.account.waiting(session.user.email));
      void result;
    } catch (error) {
      const err = error as { status?: number; code?: string; body?: Record<string, unknown> };
      if (err.status === 401) {
        window.location.href = '/signin?next=/confirm';
        return;
      }
      if (err.code === 'already_confirmed') {
        accountStatus.textContent = COPY.account.confirmed;
        return;
      }
      if (err.code === 'rate_limited') {
        accountStatus.textContent = COPY.account.signInLimited(Number(err.body?.retry_after ?? 0));
        return;
      }
      accountStatus.textContent = COPY.account.mailFailed;
    }
  });
}
