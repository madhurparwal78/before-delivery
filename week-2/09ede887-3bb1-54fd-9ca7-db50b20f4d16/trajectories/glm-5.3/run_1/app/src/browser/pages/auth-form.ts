/**
 * Sign in and sign up. A rejected form keeps what was typed, marks and names
 * each wrong field, lists the errors in a summary that links to them, and
 * stores nothing. After success the visitor returns to the same-origin `next`.
 */

import * as api from '../api.js';
import { el, announce } from '../dom.js';
import { state } from '../state.js';
import { route, navigate } from '../router.js';
import { renderAccountControls } from '../chrome.js';

/** The safe `next` address: same-origin paths only, keeping the query. */
export function currentNext(): string {
  const next = new URLSearchParams(location.search).get('next');
  if (next === null || next === '' || !next.startsWith('/') || next[1] === '/' || next[1] === '\\') {
    return '/agenda';
  }
  return next;
}

/** A visitor is sent to sign in, keeping the current address as `next`. */
export function navigateToSignIn(): void {
  const next = `${location.pathname}${location.search}`;
  navigate(`/signin?next=${encodeURIComponent(next)}`);
}

route(/^\/signin$/, async () => {
  const app = document.getElementById('app') as HTMLElement;
  const main = el('main', { id: 'main' });
  app.textContent = '';
  app.append(main);
  main.append(buildAuthForm('signin'));
});

route(/^\/signup$/, async () => {
  const app = document.getElementById('app') as HTMLElement;
  const main = el('main', { id: 'main' });
  app.textContent = '';
  app.append(main);
  main.append(buildAuthForm('signup'));
});

function buildAuthForm(kind: 'signin' | 'signup'): HTMLElement {
  const isSignup = kind === 'signup';
  const next = currentNext();
  const summary = el('div', { class: 'error-summary', role: 'alert', hidden: true });
  const fields: Array<{ id: string; label: string; type: string; error: string; autocomplete: string }> = isSignup
    ? [
        { id: 'name', label: 'Name', type: 'text', error: 'Enter a name of 1 to 80 characters.', autocomplete: 'name' },
        { id: 'email', label: 'Email', type: 'email', error: 'Enter a valid email address.', autocomplete: 'email' },
        { id: 'password', label: 'Password', type: 'password', error: 'Use at least 8 characters.', autocomplete: 'new-password' },
      ]
    : [
        { id: 'email', label: 'Email', type: 'email', error: 'Enter a valid email address.', autocomplete: 'email' },
        { id: 'password', label: 'Password', type: 'password', error: 'Enter your password.', autocomplete: 'current-password' },
      ];

  const box = el('div', { class: 'auth-box' });
  box.append(
    el('h1', { class: 'page-title' }, isSignup ? 'Create an account' : 'Sign in'),
    el('p', { class: 'chapter-copy' },
      isSignup ? 'Create an attendee account to reserve seats.' : 'Sign in to reserve seats and save sessions.'),
  );
  const form = el('form', { class: 'auth-form', novalidate: true });
  const inputs: Record<string, HTMLInputElement> = {};
  const messages: Record<string, HTMLElement> = {};
  for (const f of fields) {
    const input = el('input', {
      type: f.type, 'aria-label': f.label, class: 'text-input', id: f.id, autocomplete: f.autocomplete,
    });
    const message = el('p', { class: 'field-error', id: `${f.id}-error`, hidden: true });
    input.setAttribute('aria-describedby', `${f.id}-error`);
    inputs[f.id] = input;
    messages[f.id] = message;
    form.append(input, message);
  }
  const submit = el('button', { type: 'submit', class: 'action action-blue' },
    isSignup ? 'Create account' : 'Sign in');
  form.append(submit);
  form.append(
    el('p', { class: 'auth-alt' },
      isSignup
        ? el('a', { href: `/signin?next=${encodeURIComponent(next)}` }, 'Sign in instead')
        : el('a', { href: `/signup?next=${encodeURIComponent(next)}` }, 'Create an account'),
    ),
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    // Keep everything typed, including the password.
    summary.setAttribute('hidden', '');
    for (const f of fields) {
      messages[f.id]!.setAttribute('hidden', '');
      inputs[f.id]!.setAttribute('aria-invalid', 'false');
    }
    const wrong: Array<{ id: string; copy: string }> = [];
    if (isSignup) {
      const name = inputs.name!.value;
      if (name.length < 1 || name.length > 80 || /[\n\r]/.test(name) || name.trim() === '') {
        wrong.push({ id: 'name', copy: 'Enter a name of 1 to 80 characters.' });
      }
      if (!validEmail(inputs.email!.value)) wrong.push({ id: 'email', copy: 'Enter a valid email address.' });
      if (inputs.password!.value.length < 8 || inputs.password!.value.length > 200) {
        wrong.push({ id: 'password', copy: 'Use at least 8 characters.' });
      }
    } else {
      if (inputs.email!.value === '') wrong.push({ id: 'email', copy: 'Enter a valid email address.' });
      if (inputs.password!.value === '') wrong.push({ id: 'password', copy: 'Enter your password.' });
    }
    if (wrong.length > 0) {
      for (const w of wrong) {
        messages[w.id]!.textContent = w.copy;
        messages[w.id]!.removeAttribute('hidden');
        inputs[w.id]!.setAttribute('aria-invalid', 'true');
      }
      summary.textContent = '';
      summary.append(
        el('h2', { class: 'error-summary-heading' }, 'There is a problem'),
        ...wrong.map((w) => el('a', { href: `#${w.id}`, class: 'error-link' }, w.copy)),
      );
      summary.removeAttribute('hidden');
      return;
    }
    submit.setAttribute('aria-disabled', 'true');
    submit.classList.add('is-pending');
    announce(state.accountMessages, isSignup ? 'Creating account…' : 'Signing in…');
    try {
      const result = isSignup
        ? await api.signup({
            name: inputs.name!.value,
            email: inputs.email!.value,
            password: inputs.password!.value,
          })
        : await api.signin({ email: inputs.email!.value, password: inputs.password!.value });
      api.storeToken(result.token);
      state.account = result.account;
      renderAccountControls(document.querySelector('.account-controls') as HTMLElement);
      announce(state.accountMessages,
        isSignup ? `Welcome, ${result.account.name}.` : `Welcome back, ${result.account.name}.`);
      navigate(next);
    } catch (err) {
      const failure = err instanceof api.ApiError ? err.failure : null;
      if (failure?.code === 'invalid_credentials' || failure?.code === 'rate_limited') {
        // Only the form-level copy is shown; no error summary, no invalid fields.
        announce(state.accountMessages,
          failure.code === 'rate_limited'
            ? 'Too many sign-in attempts. Try again in a few minutes.'
            : 'Email or password is incorrect.');
      } else if (failure?.code === 'email_taken') {
        messages.email!.textContent = 'An account with this email already exists.';
        messages.email!.removeAttribute('hidden');
        inputs.email!.setAttribute('aria-invalid', 'true');
        summary.textContent = '';
        summary.append(
          el('h2', { class: 'error-summary-heading' }, 'There is a problem'),
          el('a', { href: '#email', class: 'error-link' }, 'An account with this email already exists.'),
        );
        summary.removeAttribute('hidden');
      } else {
        announce(state.accountMessages, 'Keel Outpost is not reachable right now. Try again in a moment.');
      }
      submit.setAttribute('aria-disabled', 'false');
      submit.classList.remove('is-pending');
    }
  });

  box.append(summary, form);
  return box;
}

/** Email rules, shared with the server's shape: one `@`, a domain with a dot. */
function validEmail(email: string): boolean {
  const at = email.indexOf('@');
  if (at < 1) return false;
  if (email.indexOf('@', at + 1) !== -1) return false;
  const domain = email.slice(at + 1);
  return domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.');
}

