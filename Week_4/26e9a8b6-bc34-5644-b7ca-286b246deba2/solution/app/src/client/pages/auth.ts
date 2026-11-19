import { accountStatus } from '../../shared/copy';
import { ApiFailure, post } from '../api';
import { h } from '../dom';
import { localPath } from '../nav';
import { Status } from '../status';
import type { User } from '../../shared/types';

const field = (id: string, label: string, type: string, autocomplete: string) =>
  h('label', { class: 'cell', for: id }, h('span', { class: 'cell-label' }, label), h('input', { id, name: id, type, class: 'field-input', autocomplete, required: true }));

const value = (form: HTMLFormElement, id: string) => (form.querySelector<HTMLInputElement>(`#${id}`)?.value ?? '').trim();

function page(title: string, ...children: Node[]): HTMLElement {
  return h('main', { class: 'form-page' },
    h('a', { class: 'wordmark', href: '/' }, 'Pennywasher'),
    h('h1', { class: 'page-title' }, title), ...children);
}

export function mountSignIn(root: HTMLElement): void {
  const status = new Status('Account status', 'account-status');
  const form = h('form', { class: 'form', novalidate: true },
    field('email', 'Email', 'email', 'username'), field('password', 'Password', 'password', 'current-password'),
    h('button', { type: 'submit', class: 'button' }, 'Sign in'));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await post('/api/session', { email: value(form, 'email'), password: (form.querySelector<HTMLInputElement>('#password')?.value ?? '') });
      location.assign(localPath(new URLSearchParams(location.search).get('next')));
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'bad_credentials') status.set(accountStatus.badSignin, 'error');
      else if (error instanceof ApiFailure && error.code === 'rate_limited') status.set(accountStatus.signinLimited(error.retryAfter), 'error');
      else status.set(accountStatus.badSignin, 'error');
    }
  });
  root.append(page('Sign in', form, status.element, h('a', { class: 'text-link', href: '/signup' }, 'Create an account')));
}

export function mountSignUp(root: HTMLElement): void {
  const status = new Status('Account status', 'account-status');
  const form = h('form', { class: 'form', novalidate: true },
    field('name', 'Name', 'text', 'name'), field('email', 'Email', 'email', 'username'), field('password', 'Password', 'password', 'new-password'),
    h('button', { type: 'submit', class: 'button' }, 'Sign up'));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = value(form, 'email');
    try {
      await post('/api/accounts', { name: value(form, 'name'), email, password: form.querySelector<HTMLInputElement>('#password')?.value ?? '' });
      sessionStorage.setItem('pennywasher-signup', JSON.stringify({ email, sent: true }));
      location.assign('/confirm');
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'mail_unavailable') {
        sessionStorage.setItem('pennywasher-signup', JSON.stringify({ email, sent: false }));
        location.assign('/confirm');
      } else if (error instanceof ApiFailure && error.code === 'email_taken') status.set(accountStatus.emailTaken, 'error');
      else status.set(accountStatus.badSignin, 'error');
    }
  });
  root.append(page('Sign up', form, status.element, h('a', { class: 'text-link', href: '/signin' }, 'Sign in instead')));
}

/** The confirm screen: the waiting copy only after the SMTP server accepted, the confirmed copy, or the bad-token page. */
export async function mountConfirm(root: HTMLElement, user: User | null): Promise<void> {
  const status = new Status('Account status', 'account-status');
  const link = h('button', { type: 'button', class: 'button', id: 'resend' }, 'Send a new link');
  root.append(page('Confirm your email', status.element, link));
  const token = new URLSearchParams(location.search).get('token');
  if (token !== null) {
    try {
      await post('/api/account/confirm', { token });
      status.set(accountStatus.confirmed);
      link.hidden = true;
      history.replaceState(null, '', '/confirm');
    } catch {
      status.set(accountStatus.badToken, 'error');
    }
  } else if (user?.confirmed) {
    status.set(accountStatus.confirmed);
    link.hidden = true;
  } else {
    const signup = sessionStorage.getItem('pennywasher-signup');
    sessionStorage.removeItem('pennywasher-signup');
    const sent = signup ? (JSON.parse(signup) as { email: string; sent: boolean }) : null;
    if (sent) status.set(sent.sent ? accountStatus.waiting(sent.email) : accountStatus.mailFailed, sent.sent ? 'info' : 'error');
  }
  link.addEventListener('click', async () => {
    if (!user) return location.assign('/signin?next=/confirm');
    try {
      await post('/api/account/resend');
      status.set(accountStatus.waiting(user.email));
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'rate_limited') status.set(accountStatus.resendLimited(error.retryAfter), 'error');
      else if (error instanceof ApiFailure && error.code === 'already_confirmed') status.set(accountStatus.confirmed);
      else status.set(accountStatus.mailFailed, 'error');
    }
  });
}
