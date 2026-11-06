import { request } from '../api.js';
import { noticeCopy, pendingCopy } from '../copy.js';
import { button, el, field } from '../dom.js';
import { navigate } from '../router.js';
import { loadSession, state } from '../store.js';
import { timeZoneSelect } from '../ui/panels/profile.js';
import { run } from '../ui/action.js';
import type { Me } from '../apitypes.js';

export type AuthScreen = { node: HTMLElement };

function column(heading: string, children: (Node | string)[]): HTMLElement {
  return el('div', { class: 'auth-screen' }, [
    el('p', { class: 'product-name', text: 'Saltreach' }),
    el('h1', { text: heading }),
    el('div', { class: 'auth-panel' }, children)
  ]);
}

function link(label: string, path: string): HTMLAnchorElement {
  const anchor = el('a', { href: path, text: label, 'aria-label': label, class: 'auth-link' });
  anchor.addEventListener('click', (event) => {
    event.preventDefault();
    navigate(path);
  });
  return anchor;
}

export function signUpScreen(): AuthScreen {
  const email = field('Email', 'email');
  const password = field('Password', 'password');
  const displayName = field('Display name');
  const zone = timeZoneSelect(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const submit = button('Create island', { class: 'primary' });
  submit.addEventListener('click', () => {
    void run({
      action: 'signup',
      pending: pendingCopy.signup,
      control: submit,
      fields: { email, password, displayName },
      work: () =>
        request<{ status: string }>('POST', '/api/auth/signup', {
          body: {
            email: email.input.value,
            password: password.input.value,
            displayName: displayName.input.value,
            timeZone: zone.value
          }
        }),
      success: () => noticeCopy.signupSuccess(email.input.value)
    });
  });
  return {
    node: column('Make your island', [
      email.wrapper,
      password.wrapper,
      displayName.wrapper,
      el('label', { class: 'zone-label' }, ['Time zone', zone]),
      submit,
      link('Sign in instead', '/signin')
    ])
  };
}

export function signInScreen(): AuthScreen {
  const email = field('Email', 'email');
  const password = field('Password', 'password');
  const submit = button('Sign in', { class: 'primary' });
  submit.addEventListener('click', () => {
    void run({
      action: 'signin',
      pending: pendingCopy.signin,
      control: submit,
      fields: { email, password },
      work: () =>
        request<{ user: Me; csrfToken: string }>('POST', '/api/auth/signin', {
          body: { email: email.input.value, password: password.input.value }
        }),
      success: () => null
    }).then(async (result) => {
      if (result === null) return;
      await loadSession();
      navigate(state.user?.role === 'operator' ? '/ops' : '/');
    });
  });
  const resend = button('Send a new confirmation link');
  resend.addEventListener('click', () => {
    void run({
      action: 'resend',
      pending: pendingCopy.resend,
      control: resend,
      fields: { email },
      work: () =>
        request<{ status: string }>('POST', '/api/auth/resend-verification', {
          body: { email: email.input.value }
        }),
      success: () => noticeCopy.resendSuccess(email.input.value)
    });
  });
  return {
    node: column('Back to the flats', [
      email.wrapper,
      password.wrapper,
      submit,
      link('Forgot password?', '/forgot'),
      link('Create an account', '/signup'),
      resend
    ])
  };
}

export function forgotScreen(): AuthScreen {
  const email = field('Email', 'email');
  const submit = button('Send reset link', { class: 'primary' });
  submit.addEventListener('click', () => {
    void run({
      action: 'forgot',
      pending: pendingCopy.forgot,
      control: submit,
      fields: { email },
      work: () =>
        request<{ status: string }>('POST', '/api/auth/forgot', {
          body: { email: email.input.value }
        }),
      success: () => noticeCopy.forgotSuccess(email.input.value)
    });
  });
  return { node: column('Reset your password', [email.wrapper, submit]) };
}

export function resetScreen(token: string): AuthScreen {
  const password = field('New password', 'password');
  const submit = button('Set new password', { class: 'primary' });
  submit.addEventListener('click', () => {
    void run({
      action: 'reset',
      pending: pendingCopy.reset,
      control: submit,
      fields: { password },
      work: () =>
        request<{ status: string }>('POST', '/api/auth/reset', {
          body: { token, password: password.input.value }
        }),
      success: () => noticeCopy.resetSuccess
    });
  });
  return { node: column('Choose a new password', [password.wrapper, submit]) };
}

export function verifyScreen(token: string): AuthScreen {
  const node = column('Confirming your email', [link('Go to sign in', '/signin')]);
  void run({
    action: 'confirm',
    pending: pendingCopy.confirm,
    work: () =>
      request<{ status: string }>('POST', '/api/auth/verify', { body: { token } }),
    success: () => noticeCopy.confirmSuccess
  });
  return { node };
}
