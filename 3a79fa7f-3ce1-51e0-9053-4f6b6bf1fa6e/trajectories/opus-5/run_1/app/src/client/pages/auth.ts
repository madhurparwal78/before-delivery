import { errorBody, post } from '../api.js';
import { el } from '../dom.js';
import { clearMe } from '../store.js';
import { announce, applyFieldErrors, field, type FieldHandle } from '../ui.js';

function nextAddress(): string {
  const next = new URLSearchParams(window.location.search).get('next');
  return next && next.startsWith('/') ? next : '/account';
}

export function renderSignup(main: HTMLElement): void {
  const email = field('Email', 'text', { type: 'email', autocomplete: 'email' });
  const password = field('Password', 'text', { type: 'password', autocomplete: 'new-password', helper: '10 or more characters with a letter and a digit' });
  const confirm = field('Confirm password', 'text', { type: 'password', autocomplete: 'new-password' });
  const submit = el('button', { class: 'btn', type: 'button' }, 'Create account');
  const alert = el('div', { class: 'alert-region', role: 'alert' });
  const handles: Record<string, FieldHandle> = { email, password };

  submit.addEventListener('click', async () => {
    alert.textContent = '';
    for (const handle of [email, password, confirm]) handle.setError(null);
    if (password.control.value !== confirm.control.value) {
      confirm.setError('Passwords do not match.');
      confirm.control.focus();
      return;
    }
    submit.disabled = true;
    submit.textContent = 'Creating account...';
    const result = await post('/api/auth/signup', { email: email.control.value, password: password.control.value });
    submit.disabled = false;
    submit.textContent = 'Create account';
    if (!result.ok) {
      const body = errorBody(result);
      applyFieldErrors(handles, body.fields);
      if (!body.fields) alert.textContent = body.message;
      return;
    }
    clearMe();
    window.location.assign(nextAddress());
  });

  main.replaceChildren(
    el('section', { class: 'band wrap stack narrow' }, [
      el('h1', {}, 'Create your account'),
      el('form', { novalidate: true }, [alert, email.wrapper, password.wrapper, confirm.wrapper, submit]),
      el('p', {}, el('a', { href: '/login' }, 'Already have an account? Sign in')),
    ]),
  );
}

export function renderLogin(main: HTMLElement): void {
  const email = field('Email', 'text', { type: 'email', autocomplete: 'email' });
  const password = field('Password', 'text', { type: 'password', autocomplete: 'current-password' });
  const submit = el('button', { class: 'btn', type: 'button' }, 'Sign in');
  const alert = el('div', { class: 'alert-region', role: 'alert' });

  submit.addEventListener('click', async () => {
    alert.textContent = '';
    submit.disabled = true;
    submit.textContent = 'Signing in...';
    const result = await post<{ user: { role: string } }>('/api/auth/login', {
      email: email.control.value,
      password: password.control.value,
    });
    submit.disabled = false;
    submit.textContent = 'Sign in';
    if (!result.ok) {
      alert.textContent = errorBody(result).message;
      return;
    }
    clearMe();
    const next = new URLSearchParams(window.location.search).get('next');
    if (next && next.startsWith('/')) window.location.assign(next);
    else window.location.assign(result.body.user.role === 'customer' ? '/account' : '/staff');
  });

  main.replaceChildren(
    el('section', { class: 'band wrap stack narrow' }, [
      el('h1', {}, 'Sign in'),
      el('form', { novalidate: true }, [alert, email.wrapper, password.wrapper, submit]),
      el('p', {}, el('a', { href: '/forgot-password' }, 'Forgot your password?')),
      el('p', {}, el('a', { href: '/signup' }, 'Create an account')),
    ]),
  );
}

export function renderForgotPassword(main: HTMLElement): void {
  const email = field('Email', 'text', { type: 'email', autocomplete: 'email' });
  const submit = el('button', { class: 'btn', type: 'button' }, 'Send reset link');
  const done = el('p', { role: 'status' });

  submit.addEventListener('click', async () => {
    done.textContent = 'Sending...';
    submit.disabled = true;
    const result = await post<{ message: string }>('/api/auth/password-reset', { email: email.control.value });
    submit.disabled = false;
    done.textContent = result.ok ? result.body.message : errorBody(result).message;
  });

  main.replaceChildren(
    el('section', { class: 'band wrap stack narrow' }, [
      el('h1', {}, 'Forgot your password?'),
      el('form', { novalidate: true }, [email.wrapper, submit, done]),
    ]),
  );
}

export function renderResetPassword(main: HTMLElement): void {
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const password = field('New password', 'text', { type: 'password', autocomplete: 'new-password' });
  const confirm = field('Confirm new password', 'text', { type: 'password', autocomplete: 'new-password' });
  const submit = el('button', { class: 'btn', type: 'button' }, 'Reset password');
  const alert = el('div', { class: 'alert-region', role: 'alert' });
  const handles: Record<string, FieldHandle> = { password };

  submit.addEventListener('click', async () => {
    alert.textContent = '';
    for (const handle of [password, confirm]) handle.setError(null);
    if (password.control.value !== confirm.control.value) {
      confirm.setError('Passwords do not match.');
      confirm.control.focus();
      return;
    }
    submit.disabled = true;
    submit.textContent = 'Saving...';
    const result = await post<{ message: string }>('/api/auth/password-reset/confirm', {
      token,
      password: password.control.value,
    });
    submit.disabled = false;
    submit.textContent = 'Reset password';
    if (!result.ok) {
      const body = errorBody(result);
      applyFieldErrors(handles, body.fields);
      if (!body.fields?.password) alert.textContent = body.message;
      return;
    }
    clearMe();
    announce('Your password has been reset.');
    window.setTimeout(() => window.location.assign('/login'), 400);
  });

  main.replaceChildren(
    el('section', { class: 'band wrap stack narrow' }, [
      el('h1', {}, 'Choose a new password'),
      el('form', { novalidate: true }, [alert, password.wrapper, confirm.wrapper, submit]),
    ]),
  );
}
