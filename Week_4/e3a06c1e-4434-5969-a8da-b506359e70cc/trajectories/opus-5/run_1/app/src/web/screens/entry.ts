import { ApiFailure, request } from '../api.js';
import { el, field, showFieldError } from '../dom.js';
import { navigate, type Screen } from '../router.js';
import { loadIdentity } from '../state.js';
import { StatusRegion } from '../ui/status.js';
import { genericFailure, joinCopy, signInCopy } from '../../shared/copy.js';
import type { Role } from '../../shared/types.js';

interface AuthReply {
  user: { id: string; name: string; email: string; role: Role; org_id: string };
  landing: string;
}

const card = (title: string, children: readonly HTMLElement[]): HTMLElement =>
  el('main', { class: 'entry' }, [
    el('section', { class: 'entry-card' }, [el('h1', { class: 'entry-title', text: title }), ...children]),
  ]);

export const signInScreen = (): Screen => {
  const status = new StatusRegion('Sign-in status');
  const email = el('input', { type: 'email', id: 'sign-in-email', 'aria-label': 'Email', class: 'input' });
  const password = el('input', { type: 'password', id: 'sign-in-password', class: 'input' });
  const submit = el('button', { type: 'submit', class: 'button button-primary', text: 'Sign in' });
  const emailField = field('Email', email, 'sign-in-email-error');
  const passwordField = field('Password', password, 'sign-in-password-error');

  const form = el('form', { class: 'entry-form', novalidate: true }, [
    emailField.row,
    passwordField.row,
    submit,
    status.node,
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit.disabled = true;
    void request<AuthReply>('/api/auth/sign-in', {
      method: 'POST',
      json: { email: email.value, password: password.value },
    })
      .then(async (reply) => {
        await loadIdentity();
        navigate(reply.landing, { replace: true });
      })
      .catch((error: unknown) => {
        submit.disabled = false;
        status.set(error instanceof ApiFailure && error.status === 401 ? signInCopy.failed : genericFailure);
      });
  });

  return { node: card('Sign in', [form]) };
};

export const joinScreen = (token: string): Screen => {
  const status = new StatusRegion('Join status');
  const password = el('input', { type: 'password', id: 'join-password', class: 'input' });
  const submit = el('button', { type: 'submit', class: 'button button-primary', text: 'Join workspace' });
  const passwordField = field('Choose a password', password, 'join-password-error');

  const form = el('form', { class: 'entry-form', novalidate: true }, [passwordField.row, submit, status.node]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit.disabled = true;
    showFieldError(password, passwordField.error, null);
    void request<AuthReply>(`/api/invitations/${encodeURIComponent(token)}/accept`, {
      method: 'POST',
      json: { password: password.value },
    })
      .then(async (reply) => {
        await loadIdentity();
        navigate(reply.landing, { replace: true });
      })
      .catch((error: unknown) => {
        submit.disabled = false;
        if (error instanceof ApiFailure && error.status === 410) {
          status.set(joinCopy.used);
          return;
        }
        if (error instanceof ApiFailure && error.fields.password !== undefined) {
          showFieldError(password, passwordField.error, error.fields.password);
          return;
        }
        status.set(genericFailure);
      });
  });

  return { node: card('Join the workspace', [form]) };
};
