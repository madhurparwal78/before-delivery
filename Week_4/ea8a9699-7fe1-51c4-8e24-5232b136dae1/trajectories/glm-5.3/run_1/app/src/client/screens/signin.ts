// Sign in, sign up and invite acceptance screens.

import type { Account, ApiError } from '../../shared/types.js';
import { api, el, link, navigate, session, setSession } from '../lib.js';
import { topBar } from '../app.js';

/** Validate the return path: only a Rushes screen is honoured. */
export function safeReturnPath(next: string | null): string | null {
  if (!next) return null;
  // The next value has already been URL-decoded once by the browser.
  if (!next.startsWith('/')) return null;
  if (next[1] === '/' || next[1] === '\\') return null;
  if (next.includes('\\')) return null;
  if (next.toLowerCase().includes('%5c')) return null;
  if (next.toLowerCase().includes('%2f%2f')) return null;
  if (/[\u0000-\u001f\u007f]/.test(next)) return null;
  const own =
    next === '/explore' ||
    /^\/@[^/]+$/.test(next) ||
    /^\/c\/[^/]+$/.test(next) ||
    /^\/w\/[^/]+(\/.*)?$/.test(next);
  return own ? next : null;
}

export function defaultDestination(account: Account): string {
  if (account.role === 'ops_lead') {
    const first = account.workspaces[0];
    return first ? `/w/${first.slug}` : '/explore';
  }
  if (account.role === 'designer') {
    const ws = account.workspaces[0];
    return ws ? `/w/${ws.slug}` : '/explore';
  }
  return '/explore';
}

export function errorSummary(errors: Record<string, string>, fieldTargets: Record<string, string>): HTMLElement {
  const summary = el('div', { class: 'error-summary', role: 'alert', id: 'error-summary', tabindex: '-1' });
  const h = el('h2', {}, 'There is a problem');
  summary.append(h);
  const ul = el('ul');
  for (const [field, message] of Object.entries(errors)) {
    const li = el('li');
    const a = el('a', { href: `#${fieldTargets[field] ?? field}` }, message);
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.getElementById(fieldTargets[field] ?? field);
      target?.focus();
    });
    li.append(a);
    ul.append(li);
  }
  summary.append(ul);
  return summary;
}

/** Attach invalid state and message to a field's control. */
export function markInvalid(input: HTMLInputElement | HTMLTextAreaElement, message: string): void {
  input.setAttribute('aria-invalid', 'true');
  input.setAttribute('aria-describedby', `${input.id}-error`);
  let msg = document.getElementById(`${input.id}-error`);
  if (!msg) {
    msg = el('div', { class: 'error-message', id: `${input.id}-error` });
    input.after(msg);
  }
  msg.textContent = message;
}

export function clearInvalid(form: HTMLElement): void {
  form.querySelectorAll('[aria-invalid="true"]').forEach((n) => n.removeAttribute('aria-invalid'));
  form.querySelectorAll('.error-message').forEach((n) => n.remove());
  document.getElementById('error-summary')?.remove();
}

export function formField(labelText: string, input: HTMLInputElement | HTMLTextAreaElement, hint?: string): HTMLElement {
  const field = el('div', { class: 'field' });
  const label = el('label', { for: input.id }, labelText);
  field.append(label, input);
  if (hint) field.append(el('div', { class: 'muted small' }, hint));
  return field;
}

export async function renderSignIn(params: URLSearchParams): Promise<HTMLElement> {
  const next = safeReturnPath(params.get('next'));
  const main = el('main', { class: 'page-narrow' });
  main.append(topBar({ account: session()?.account ?? null, bare: true }));

  const section = el('section', { class: 'panel' });
  section.append(el('h1', {}, 'Sign in to Rushes'));
  const form = el('form', { novalidate: true }) as HTMLFormElement;
  const email = el('input', { type: 'email', id: 'signin-email', autocomplete: 'email' }) as HTMLInputElement;
  email.setAttribute('aria-label', 'Email');
  const password = el('input', { type: 'password', id: 'signin-password', autocomplete: 'current-password' }) as HTMLInputElement;
  password.setAttribute('aria-label', 'Password');
  const submit = el('button', { type: 'submit', class: 'btn btn-primary' }, 'Sign in') as HTMLButtonElement;
  submit.setAttribute('aria-label', 'Sign in');

  form.append(
    formField('Email', email),
    formField('Password', password),
    el('div', {}, submit),
  );

  const nav = el('p', { class: 'small' });
  const createLink = link(`/signup${next ? `?next=${encodeURIComponent(next)}` : ''}`, 'Create an account');
  nav.append('No account? ', createLink);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearInvalid(section);
    submit.disabled = true;
    const r = await api<Account>('POST', '/api/auth/signin', { email: email.value, password: password.value });
    submit.disabled = false;
    if (r.ok && r.data) {
      setSession({ account: r.data });
      navigate(next ?? defaultDestination(r.data));
      return;
    }
    const err = r.error as ApiError | null;
    if (err?.error === 'validation') {
      const errors = err.errors ?? {};
      section.prepend(errorSummary(errors, { email: 'signin-email', password: 'signin-password' }));
      document.getElementById('error-summary')?.focus();
      for (const [field, message] of Object.entries(errors)) {
        const input = field === 'email' ? email : password;
        markInvalid(input, message);
      }
    } else {
      // Wrong credentials map to the Email field.
      const message = err?.message ?? 'Email or password is incorrect.';
      section.prepend(errorSummary({ email: message }, { email: 'signin-email' }));
      document.getElementById('error-summary')?.focus();
      markInvalid(email, message);
    }
  });

  section.append(form, nav);
  main.append(section);
  return main;
}

export async function renderSignUp(params: URLSearchParams): Promise<HTMLElement> {
  const next = safeReturnPath(params.get('next'));
  const main = el('main', { class: 'page-narrow' });
  main.append(topBar({ account: session()?.account ?? null, bare: true }));

  const section = el('section', { class: 'panel' });
  section.append(el('h1', {}, 'Follow curators on Rushes'));
  const form = el('form', { novalidate: true }) as HTMLFormElement;
  const email = el('input', { type: 'email', id: 'signup-email', autocomplete: 'email' }) as HTMLInputElement;
  email.setAttribute('aria-label', 'Email');
  const displayName = el('input', { type: 'text', id: 'signup-displayname', autocomplete: 'name' }) as HTMLInputElement;
  displayName.setAttribute('aria-label', 'Display name');
  const handle = el('input', { type: 'text', id: 'signup-handle', autocomplete: 'username' }) as HTMLInputElement;
  handle.setAttribute('aria-label', 'Handle');
  const password = el('input', { type: 'password', id: 'signup-password', autocomplete: 'new-password' }) as HTMLInputElement;
  password.setAttribute('aria-label', 'Password');
  const submit = el('button', { type: 'submit', class: 'btn btn-primary' }, 'Create account') as HTMLButtonElement;
  submit.setAttribute('aria-label', 'Create account');

  form.append(
    formField('Email', email),
    formField('Display name', displayName),
    formField('Handle', handle, '3 to 24 lowercase letters, digits or hyphens.'),
    formField('Password', password, 'Use at least 10 characters.'),
    el('div', {}, submit),
  );

  const nav = el('p', { class: 'small' });
  nav.append('Already have an account? ', link(`/signin${next ? `?next=${encodeURIComponent(next)}` : ''}`, 'Sign in'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearInvalid(section);
    submit.disabled = true;
    const r = await api<Account>('POST', '/api/auth/signup', {
      email: email.value,
      displayName: displayName.value,
      handle: handle.value,
      password: password.value,
    });
    submit.disabled = false;
    if (r.ok && r.data) {
      setSession({ account: r.data });
      navigate(next ?? defaultDestination(r.data));
      return;
    }
    const errors = r.error?.errors ?? {};
    section.prepend(errorSummary(errors, { email: 'signup-email', displayName: 'signup-displayname', handle: 'signup-handle', password: 'signup-password' }));
    document.getElementById('error-summary')?.focus();
    for (const [field, message] of Object.entries(errors)) {
      const input = { email, displayName, handle, password }[field as 'email' | 'displayName' | 'handle' | 'password'];
      if (input) markInvalid(input, message);
    }
  });

  section.append(form, nav);
  main.append(section);
  return main;
}

export async function renderInvite(token: string): Promise<HTMLElement> {
  const main = el('main', { class: 'page-narrow' });
  const info = await api<{ workspaceName: string; email: string; displayName: string }>('GET', `/api/invites/${token}`);
  if (!info.ok) {
    main.append(el('section', { class: 'panel' }, el('h1', {}, info.error?.error === 'invite_used' ? 'This invite has already been used.' : 'This page does not exist.')));
    return main;
  }
  main.append(topBar({ account: session()?.account ?? null, bare: true }));
  const section = el('section', { class: 'panel' });
  section.append(
    el('h1', {}, `Join ${info.data!.workspaceName}`),
    el('p', { class: 'muted' }, `Invited as ${info.data!.email}`),
  );
  const form = el('form', { novalidate: true }) as HTMLFormElement;
  const handle = el('input', { type: 'text', id: 'invite-handle' }) as HTMLInputElement;
  handle.setAttribute('aria-label', 'Handle');
  const password = el('input', { type: 'password', id: 'invite-password' }) as HTMLInputElement;
  password.setAttribute('aria-label', 'Password');
  const submit = el('button', { type: 'submit', class: 'btn btn-primary' }, `Join ${info.data!.workspaceName}`) as HTMLButtonElement;
  form.append(
    formField('Handle', handle),
    formField('Password', password, 'Use at least 10 characters.'),
    el('div', {}, submit),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearInvalid(section);
    submit.disabled = true;
    const r = await api<Account>('POST', `/api/invites/${token}/accept`, { handle: handle.value, password: password.value });
    submit.disabled = false;
    if (r.ok && r.data) {
      setSession({ account: r.data });
      navigate(defaultDestination(r.data));
      return;
    }
    const errors = r.error?.errors ?? {};
    section.prepend(errorSummary(errors, { handle: 'invite-handle', password: 'invite-password' }));
    document.getElementById('error-summary')?.focus();
    for (const [field, message] of Object.entries(errors)) {
      if (field === 'handle') markInvalid(handle, message);
      if (field === 'password') markInvalid(password, message);
    }
  });
  section.append(form);
  main.append(section);
  return main;
}
