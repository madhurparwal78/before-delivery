// Sign in, join, join confirm, forgot password and reset password.
import { h } from '../dom.js';
import { api, ApiFailure, apiErrorMessage } from '../api.js';
import { alertBand, announce, pendingButton } from '../feedback.js';
import type { PageContext } from '../app.js';

function narrowForm(): HTMLElement {
  return h('main', { class: 'narrow' });
}

function fieldRow(label: string, input: HTMLElement, name: string): { row: HTMLElement; input: HTMLElement; error: HTMLElement } {
  const error = h('p', { id: `error-${name}`, class: 'field-error', hidden: 'hidden' });
  input.setAttribute('aria-describedby', `error-${name}`);
  const row = h('div', { class: 'field-row' }, h('label', { for: input.id }, label), input, error);
  return { row, input, error };
}

function showFieldError(error: HTMLElement, message: string | null): void {
  if (message) {
    error.textContent = message;
    error.removeAttribute('hidden');
  } else {
    error.setAttribute('hidden', 'hidden');
  }
}

export function signInPage(ctx: PageContext): HTMLElement {
  const main = narrowForm();
  main.appendChild(h('h1', {}, 'Sign in'));
  const email = h('input', { type: 'email', id: 'email', autocomplete: 'email' }) as HTMLInputElement;
  const password = h('input', { type: 'password', id: 'password', autocomplete: 'current-password' }) as HTMLInputElement;
  const emailField = fieldRow('Email', email, 'email');
  const passwordField = fieldRow('Password', password, 'password');
  const submit = h('button', { class: 'solid-button', type: 'button' }, 'Sign in');
  const caption = h('span', { class: 'pending-caption' });
  const pending = pendingButton(submit, caption);
  submit.addEventListener('click', async () => {
    pending.setWorking('Working');
    try {
      await api.post('/api/auth/sign-in', { email: email.value, password: password.value });
      announce('Signed in.');
      await ctx.refreshMe();
      ctx.navigate(ctx.query.get('next') ?? '/');
    } catch (err) {
      pending.clear();
      if (err instanceof ApiFailure) {
        for (const [field, row] of [['email', emailField], ['password', passwordField]] as const) {
          showFieldError(row.error, err.fieldError(field));
        }
        if (!err.body.fields) alertBand(err.body.message);
      } else {
        alertBand(apiErrorMessage(err));
      }
    }
  });
  main.appendChild(emailField.row);
  main.appendChild(passwordField.row);
  main.appendChild(submit);
  main.appendChild(caption);
  main.appendChild(h('p', {}, h('a', { href: '/forgot-password' }, 'Forgot password?')));
  return main;
}

export function joinPage(ctx: PageContext): HTMLElement {
  const main = narrowForm();
  main.appendChild(h('h1', {}, 'Join Candour Bench'));
  const displayName = h('input', { type: 'text', id: 'display-name', autocomplete: 'name' }) as HTMLInputElement;
  const email = h('input', { type: 'email', id: 'email', autocomplete: 'email' }) as HTMLInputElement;
  const password = h('input', { type: 'password', id: 'password', autocomplete: 'new-password' }) as HTMLInputElement;
  const nameField = fieldRow('Display name', displayName, 'display_name');
  const emailField = fieldRow('Email', email, 'email');
  const passwordField = fieldRow('Password', password, 'password');
  const submit = h('button', { class: 'solid-button', type: 'button' }, 'Create account');
  const caption = h('span', { class: 'pending-caption' });
  const pending = pendingButton(submit, caption);
  submit.addEventListener('click', async () => {
    pending.setWorking('Working');
    try {
      await api.post('/api/auth/join', {
        display_name: displayName.value,
        email: email.value,
        password: password.value,
      });
      main.appendChild(h('p', {}, 'Check your email to finish joining.'));
      announce('Check your email to finish joining.');
    } catch (err) {
      pending.clear();
      if (err instanceof ApiFailure) {
        showFieldError(nameField.error, err.fieldError('display_name'));
        showFieldError(emailField.error, err.fieldError('email'));
        showFieldError(passwordField.error, err.fieldError('password'));
        if (!err.body.fields) alertBand(err.body.message);
      }
    }
  });
  main.appendChild(nameField.row);
  main.appendChild(emailField.row);
  main.appendChild(passwordField.row);
  main.appendChild(submit);
  main.appendChild(caption);
  void ctx;
  return main;
}

export function joinConfirmPage(ctx: PageContext): HTMLElement {
  const main = narrowForm();
  main.appendChild(h('h1', {}, 'Welcome to Candour Bench'));
  const token = ctx.query.get('token') ?? '';
  void api
    .post('/api/auth/join/confirm', { token })
    .then(async () => {
      await ctx.refreshMe();
      ctx.navigate('/');
    })
    .catch(() => {
      alertBand('This link has expired or was already used.');
    });
  return main;
}

export function forgotPasswordPage(_ctx: PageContext): HTMLElement {
  const main = narrowForm();
  main.appendChild(h('h1', {}, 'Forgot password'));
  const email = h('input', { type: 'email', id: 'email' }) as HTMLInputElement;
  const emailField = fieldRow('Email', email, 'email');
  const submit = h('button', { class: 'solid-button', type: 'button' }, 'Send reset link');
  submit.addEventListener('click', async () => {
    try {
      await api.post('/api/auth/forgot', { email: email.value });
      main.appendChild(h('p', {}, 'If that address has an account, a reset link is on its way.'));
      announce('If that address has an account, a reset link is on its way.');
    } catch (err) {
      if (err instanceof ApiFailure) showFieldError(emailField.error, err.fieldError('email'));
    }
  });
  main.appendChild(emailField.row);
  main.appendChild(submit);
  return main;
}

export function resetPasswordPage(ctx: PageContext): HTMLElement {
  const main = narrowForm();
  main.appendChild(h('h1', {}, 'Choose a new password'));
  const password = h('input', { type: 'password', id: 'new-password', autocomplete: 'new-password' }) as HTMLInputElement;
  const passwordField = fieldRow('New password', password, 'password');
  const submit = h('button', { class: 'solid-button', type: 'button' }, 'Change password');
  submit.addEventListener('click', async () => {
    try {
      await api.post('/api/auth/reset', {
        token: ctx.query.get('token') ?? '',
        password: password.value,
      });
      await ctx.refreshMe();
      announce('Password changed. You are signed in.');
      ctx.navigate('/');
    } catch (err) {
      if (err instanceof ApiFailure) {
        showFieldError(passwordField.error, err.fieldError('password'));
        if (err.body.error === 'token_invalid') alertBand(err.body.message);
      }
    }
  });
  main.appendChild(passwordField.row);
  main.appendChild(submit);
  return main;
}
