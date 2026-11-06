// Sign in and Create account.
import { api } from '../api.js';
import { announce, field, h, showFieldErrors } from '../dom.js';
import { hooks } from '../hooks.js';
import { loadSession } from '../session.js';
import { renderTopbar } from '../shell.js';
import { MESSAGES, RANGES } from '../domain.js';

const CONTROL = /[\u0000-\u001f\u007f]/;

/** The `next` value when both its query-decoded and doubly decoded forms are safe, otherwise null. */
function safeNext(raw) {
  if (!raw) return null;
  let twice;
  try {
    twice = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const safe = (value) => value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') && !CONTROL.test(value);
  return safe(raw) && safe(twice) ? raw : null;
}

export function render(main, { query }) {
  const signup = location.pathname === '/signup';
  const next = query.get('next');
  const email = h('input', { type: 'email', autocomplete: 'email', name: 'email' });
  const password = h('input', { type: 'password', autocomplete: signup ? 'new-password' : 'current-password', name: 'password' });
  const fields = { email: field('Email', email), password: field('Password', password) };
  const other = signup ? ['/signin', 'Sign in', 'Already have an account?'] : ['/signup', 'Create an account', 'New here?'];
  const otherHref = other[0] + (next ? `?next=${encodeURIComponent(next)}` : '');
  const submit = h('button', { type: 'submit', class: 'primary' }, signup ? 'Create account' : 'Sign in');
  const form = h('form', { class: 'form', novalidate: true }, fields.email.root, fields.password.root,
    h('div', { class: 'actions' }, submit));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const problems = {};
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value.trim())) problems.email = MESSAGES.email;
    if (signup && !(password.value.length >= RANGES.password[0] && password.value.length <= RANGES.password[1])) problems.password = MESSAGES.password;
    if (showFieldErrors(fields, problems)) return;
    announce(signup ? 'Creating account…' : 'Signing in…');
    submit.disabled = true;
    try {
      const response = await api('POST', signup ? '/api/auth/signup' : '/api/auth/signin',
        { email: email.value, password: password.value }, { keep401: true });
      if (response.ok) {
        await loadSession();
        renderTopbar('auth');
        hooks.navigate(safeNext(next) ?? '/archive');
        return;
      }
      if (response.status === 422) showFieldErrors(fields, response.data.fields);
      else announce(response.data.error === 'email_taken' ? 'An account with this email already exists.' : 'Email or password is wrong.');
    } finally {
      submit.disabled = false;
    }
  });
  main.append(h('div', { class: 'page-head' }, h('h1', {}, signup ? 'Create account' : 'Sign in')), form,
    h('p', { class: 'muted' }, `${other[2]} `, h('a', { href: otherHref }, other[1])));
}
