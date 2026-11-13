import { api, ApiRequestError } from './api.js';
import { announce, el } from './dom.js';
import { COPY } from './copy.js';
import { renderTopRow } from './app.js';
import type { PageContext } from './main.js';

// Sign-up, sign-in, reset and the reset confirmation.

type FormKind = 'signup' | 'signin' | 'reset' | 'reset-confirm';

export function renderAuthForm(context: PageContext, folder: HTMLElement, kind: FormKind, token = ''): void {
  const { app } = context;
  const sheetEl = el('div', { class: 'sheet auth-sheet' }, '');
  const form = el('form', { class: 'auth-form', novalidate: 'true' }, '');
  const message = el('div', { role: 'alert', class: 'auth-alert' }, '');
  const mailStatus = el('div', { role: 'status', 'aria-label': 'Mail status', class: 'status-region mail-status' }, '');
  const line = el('p', { class: 'auth-line' }, '');
  const submitRow = el('div', { class: 'auth-actions' }, '');

  const fields: Record<FormKind, { name: string; label: string; type: string }[]> = {
    signup: [
      { name: 'name', label: 'Display name', type: 'text' },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'password', label: 'Password', type: 'password' },
    ],
    signin: [
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'password', label: 'Password', type: 'password' },
    ],
    reset: [
      { name: 'email', label: 'Email', type: 'email' },
    ],
    'reset-confirm': [
      { name: 'password', label: 'New password', type: 'password' },
    ],
  };

  const inputs: Record<string, HTMLInputElement> = {};
  const errors: Record<string, HTMLElement> = {};
  for (const field of fields[kind]) {
    const input = el('input', { type: field.type, class: 'input', id: `auth-${field.name}`, name: field.name, autocomplete: kind === 'signin' ? 'current-password' : 'new-password' }) as unknown as HTMLInputElement;
    const label = el('label', { for: `auth-${field.name}`, class: 'input-label' }, field.label);
    const error = el('div', { class: 'field-error', id: `auth-error-${field.name}` }, '');
    inputs[field.name] = input;
    errors[field.name] = error;
    const wrap = el('div', { class: 'field' }, '');
    wrap.append(label, input, error);
    form.appendChild(wrap);
  }

  const submitLabel = kind === 'signup' ? 'Create account' : kind === 'signin' ? 'Sign in' : kind === 'reset' ? 'Send reset link' : 'Set password';
  const submit = el('button', { type: 'submit', class: 'button' }, submitLabel) as unknown as HTMLButtonElement;
  submitRow.appendChild(submit);
  form.appendChild(submitRow);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    message.textContent = '';
    for (const key of Object.keys(errors)) errors[key].textContent = '';
    try {
      if (kind === 'signup') {
        const result = await api<{ mail: 'sent' | 'retrying' }>('/api/signup', 'POST', {
          name: inputs.name.value, email: inputs.email.value, password: inputs.password.value,
        });
        await app.refreshSession();
        form.remove();
        const heading = el('h2', { class: 'sheet-heading' }, COPY.signedUpHeading);
        const sentLine = el('p', { class: 'sheet-line' }, `We sent a verification link to ${inputs.email.value.trim()}.`);
        sheetEl.append(heading, sentLine);
        if (result.mail === 'retrying') {
          announce(mailStatus, COPY.mailOutage);
          sentLine.remove();
          sheetEl.appendChild(mailStatus);
        }
      } else if (kind === 'signin') {
        await api('/api/session', 'POST', { email: inputs.email.value, password: inputs.password.value });
        await app.refreshSession();
        const returnTo = new URLSearchParams(window.location.search).get('returnTo') ?? '/';
        window.history.pushState({}, '', returnTo);
        window.dispatchEvent(new PopStateEvent('popstate'));
      } else if (kind === 'reset') {
        await api('/api/password-reset', 'POST', { email: inputs.email.value });
        form.remove();
        sheetEl.appendChild(el('p', { class: 'sheet-line' }, COPY.resetAccepted));
      } else {
        await api('/api/password-reset/confirm', 'POST', { token, password: inputs.password.value });
        app.signOutLocally();
        renderTopRow(app, context.topRow, () => context.onSignOut());
        form.remove();
        const heading = el('h2', { class: 'sheet-heading' }, COPY.passwordChangedHeading);
        sheetEl.append(heading, el('p', { class: 'sheet-line' }, COPY.passwordChangedLine));
      }
    } catch (error) {
      if (error instanceof ApiRequestError) {
        if (error.errors !== undefined) {
          for (const [field, text2] of Object.entries(error.errors)) {
            if (errors[field] !== undefined) errors[field].textContent = text2;
          }
        } else if (error.code === 'email_taken') {
          errors.email.textContent = 'An account with that email already exists.';
        } else if (error.code === 'invalid_credentials') {
          message.textContent = COPY.wrongSignIn;
        } else if (error.code === 'too_many_attempts') {
          message.textContent = `Too many attempts. Try again in ${error.retryAfter ?? 1} seconds.`;
        } else if (error.code === 'link_expired') {
          message.textContent = COPY.linkExpiredLine;
        } else {
          message.textContent = COPY.serverError;
        }
      } else {
        message.textContent = COPY.serverError;
      }
      submit.disabled = false;
    }
  });

  if (kind === 'signin') {
    const forgot = el('a', { href: '/reset', class: 'quiet-link' }, 'Forgot password');
    submitRow.appendChild(forgot);
  }

  sheetEl.append(form, message, line);
  folder.appendChild(sheetEl);
}
