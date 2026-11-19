import type { Document, Role, UserRecord } from '../shared/model.js';
import { el } from './dom.js';
import * as copy from '../shared/copy.js';

export interface AppUser { id: string; email: string; name: string }

async function api<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: T }> {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  let body = {} as T;
  try {
    body = (await res.json()) as T;
  } catch {
    body = {} as T;
  }
  return { ok: res.ok, status: res.status, body };
}

function nextParam(): string {
  const params = new URLSearchParams(location.search);
  const next = params.get('next');
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/';
  return next;
}

function nextFromCurrent(): string {
  return encodeURIComponent(`${location.pathname}${location.search}`);
}

export function renderSignIn(container: HTMLElement): void {
  const error = el('div', { class: 'form-error', role: 'alert' });
  const email = el('input', { type: 'email', 'aria-label': 'Email', autocomplete: 'email' }) as HTMLInputElement;
  const password = el('input', { type: 'password', 'aria-label': 'Password' }) as HTMLInputElement;
  const submit = el('button', { 'aria-label': 'Sign in', text: 'Sign in' }) as HTMLButtonElement;
  const signupLink = el('a', {
    href: `/signup?next=${encodeURIComponent(nextParam())}`,
    text: 'Create an account',
  });
  const form = el('form', { class: 'auth-form' }, email, password, submit, signupLink);
  const fields: Record<string, { field: HTMLElement; message: string | null }> = {
    email: { field: email, message: null },
    password: { field: password, message: null },
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors();
    const result = await api<{ user?: AppUser; error?: { code: string; fields?: Record<string, string>; message: string } }>('/api/auth/signin', {
      method: 'POST',
      body: JSON.stringify({ email: email.value, password: password.value }),
    });
    if (result.ok) {
      location.href = nextParam();
      return;
    }
    if (result.status === 401) {
      error.textContent = copy.signInError;
      return;
    }
    applyFieldErrors(result.body.error?.fields, fields, error);
  });

  container.append(el('div', { class: 'auth-card' },
    el('h1', { text: 'Sign in', class: 'auth-title' }),
    error, form));
}

export function renderSignUp(container: HTMLElement): void {
  const error = el('div', { class: 'form-error', role: 'alert' });
  const name = el('input', { type: 'text', 'aria-label': 'Name', autocomplete: 'name' }) as HTMLInputElement;
  const email = el('input', { type: 'email', 'aria-label': 'Email', autocomplete: 'email' }) as HTMLInputElement;
  const password = el('input', { type: 'password', 'aria-label': 'Password', autocomplete: 'new-password' }) as HTMLInputElement;
  const submit = el('button', { 'aria-label': 'Create account', text: 'Create account' });
  const signinLink = el('a', {
    href: `/signin?next=${encodeURIComponent(nextParam())}`,
    text: 'Sign in instead',
  });
  const form = el('form', { class: 'auth-form' }, name, email, password, submit, signinLink);
  const fields: Record<string, { field: HTMLElement; message: string | null }> = {
    name: { field: name, message: null },
    email: { field: email, message: null },
    password: { field: password, message: null },
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors();
    const result = await api<{ user?: AppUser; error?: { code: string; fields?: Record<string, string>; message: string } }>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ name: name.value, email: email.value, password: password.value }),
    });
    if (result.ok) {
      location.href = nextParam();
      return;
    }
    if (result.body.error?.code === 'email_taken') {
      showFieldError(email, copy.fieldTakenEmailError);
      return;
    }
    applyFieldErrors(result.body.error?.fields, fields, error);
  });

  container.append(el('div', { class: 'auth-card' },
    el('h1', { text: 'Create an account', class: 'auth-title' }),
    error, form));
}

function applyFieldErrors(
  errors: Record<string, string> | undefined,
  fields: Record<string, { field: HTMLElement; message: string | null }>,
  summary: HTMLElement,
): void {
  if (!errors) {
    summary.textContent = copy.signInError;
    return;
  }
  for (const [key, message] of Object.entries(errors)) {
    const entry = fields[key];
    if (entry) showFieldError(entry.field, message);
  }
  const links = Object.keys(errors).map((key) => key).join(', ');
  summary.textContent = links;
}

function showFieldError(field: HTMLElement, message: string): void {
  field.setAttribute('aria-invalid', 'true');
  let errorEl = field.parentElement?.querySelector('.field-error') as HTMLElement | null;
  if (!errorEl) {
    errorEl = el('div', { class: 'field-error' });
    field.parentElement?.append(errorEl);
  }
  errorEl.textContent = message;
}

function clearErrors(): void {
  document.querySelectorAll('.field-error').forEach((node) => node.remove());
  document.querySelectorAll('[aria-invalid]').forEach((node) => node.removeAttribute('aria-invalid'));
}

export async function renderDiagramList(container: HTMLElement, user: AppUser): Promise<void> {
  const result = await api<{ diagrams: { id: string; title: string; role: Role }[] }>('/api/diagrams');
  const list = el('div', { class: 'diagram-list' });
  const heading = el('h1', { text: 'Your diagrams', class: 'auth-title' });
  const newBtn = el('button', { 'aria-label': 'New diagram', text: 'New diagram' });
  newBtn.addEventListener('click', async () => {
    const title = prompt('Diagram title');
    if (!title) return;
    const created = await api<{ diagram: { id: string } }>('/api/diagrams', {
      method: 'POST',
      body: JSON.stringify({ title }),
    });
    if (created.ok) location.href = `/d/${created.body.diagram.id}`;
  });
  if ((result.body.diagrams?.length ?? 0) === 0) {
    list.append(el('p', { text: copy.emptyDiagramList }));
  } else {
    for (const diagram of result.body.diagrams ?? []) {
      list.append(el('a', { href: `/d/${diagram.id}`, text: diagram.title, class: 'diagram-link' }));
    }
  }
  const signOut = el('button', { 'aria-label': 'Sign out', text: 'Sign out', onclick: async () => {
    await fetch('/api/auth/signout', { method: 'POST' });
    location.href = '/signin';
  } });
  container.append(el('div', { class: 'diagram-list-card' }, heading, el('p', { class: 'muted', text: user.name }), newBtn, list, signOut));
}

export async function loadWorkspaceData(diagramId: string): Promise<{ document: Document; role: Role } | null> {
  const docResult = await api<Document>(`/api/diagrams/${diagramId}/document`);
  if (!docResult.ok) return null;
  const membersResult = await api<{ members: { userId: string; role: Role }[] }>(`/api/diagrams/${diagramId}/members`);
  const myUser = await api<{ user: { id: string } | null }>('/api/me');
  const me = myResult(myUser);
  let role: Role = 'viewer';
  if (membersResult.ok) {
    const mine = (membersResult.body.members ?? []).find((m) => m.userId === me?.id);
    if (mine) role = mine.role;
  }
  return { document: docResult.body as Document, role };
}

function myResult(result: { ok: boolean; body: { user: { id: string } | null } }): { id: string } | null {
  return result.ok ? result.body.user ?? null : null;
}

export async function loadMe(): Promise<AppUser | null> {
  const result = await api<{ user: AppUser }>('/api/me');
  if (!result.ok) return null;
  return result.body.user ?? null;
}

export async function loadOwnerName(diagramId: string): Promise<string> {
  const result = await api<{ members: { role: Role; name: string }[] }>(`/api/diagrams/${diagramId}/members`);
  if (!result.ok) return 'the owner';
  const owner = (result.body.members ?? []).find((m) => m.role === 'owner');
  return owner?.name ?? 'the owner';
}

export function showNotFound(container: HTMLElement): void {
  container.replaceChildren(
    el('div', { class: 'not-found' },
      el('h1', { text: copy.notFoundHeading }),
      el('p', { text: copy.notFoundText }),
      el('a', { href: '/', text: 'Back to your diagrams' })));
}
