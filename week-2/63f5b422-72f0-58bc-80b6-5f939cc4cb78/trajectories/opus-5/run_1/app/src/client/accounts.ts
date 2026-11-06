import { fieldErrors } from '../shared/notices.js';
import type { Role } from '../shared/types.js';
import { el, setText } from './dom.js';
import { RequestFailed, api } from './net.js';

interface Field {
  name: string;
  label: string;
  type: 'text' | 'email' | 'password';
}

function withNext(path: string): string {
  const next = new URL(window.location.href).searchParams.get('next');
  return next === null ? path : `${path}?next=${encodeURIComponent(next)}`;
}

function nextPath(): string {
  const next = new URL(window.location.href).searchParams.get('next');
  if (next === null || !next.startsWith('/') || next.startsWith('//')) return '/';
  return next;
}

function accountForm(
  title: string,
  fields: Field[],
  submitLabel: string,
  otherLink: { href: string; text: string },
  submit: (values: Record<string, string>) => Promise<void>,
): HTMLElement {
  const summary = el('div', { class: 'error-summary', hidden: true });
  const inputs = new Map<string, HTMLInputElement>();
  const messages = new Map<string, HTMLElement>();
  const form = el('form', { class: 'account-form', novalidate: true });
  const card = el('main', { class: 'account-card' }, [
    el('h1', {}, [title]),
    summary,
    form,
    el('p', { class: 'account-other' }, [el('a', { href: otherLink.href }, [otherLink.text])]),
  ]);
  for (const field of fields) {
    const id = `field-${field.name}`;
    const message = el('p', { class: 'field-error', id: `${id}-error` });
    const input = el('input', {
      id,
      type: field.type,
      name: field.name,
      'aria-label': field.label,
      autocomplete: field.type === 'password' ? 'current-password' : 'on',
    });
    inputs.set(field.name, input);
    messages.set(field.name, message);
    form.append(
      el('div', { class: 'field-row' }, [
        el('label', { for: id }, [field.label]),
        input,
        message,
      ]),
    );
  }
  const action = el('button', { type: 'submit', class: 'primary' }, [submitLabel]);
  form.append(action);

  const showErrors = (errors: Record<string, string>): void => {
    summary.replaceChildren(
      el('h2', {}, ['There is a problem']),
      el(
        'ul',
        {},
        Object.entries(errors).map(([name, text]) =>
          el('li', {}, [
            el(
              'a',
              { href: `#field-${name}` },
              [text],
            ),
          ]),
        ),
      ),
    );
    summary.setAttribute('role', 'alert');
    summary.hidden = false;
    for (const [name, message] of messages) {
      const text = errors[name];
      setText(message, text ?? '');
      const input = inputs.get(name)!;
      if (text === undefined) {
        input.removeAttribute('aria-describedby');
        input.removeAttribute('aria-invalid');
      } else {
        input.setAttribute('aria-describedby', `field-${name}-error`);
        input.setAttribute('aria-invalid', 'true');
      }
    }
    const firstLink = summary.querySelector('a');
    firstLink?.focus();
  };

  summary.addEventListener('click', (event) => {
    const link = (event.target as HTMLElement).closest('a');
    if (!link) return;
    event.preventDefault();
    const id = link.getAttribute('href')!.slice(1);
    document.getElementById(id)?.focus();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const values: Record<string, string> = {};
    for (const [name, input] of inputs) values[name] = input.value;
    void submit(values).catch((error: unknown) => {
      if (!(error instanceof RequestFailed)) throw error;
      const failure = error.failure;
      if (failure.status === 422) {
        showErrors(failure.fields);
        return;
      }
      if (failure.code === 'email_taken') {
        showErrors({ email: fieldErrors.emailTaken });
        return;
      }
      if (failure.code === 'invalid_credentials') {
        showErrors({ email: fieldErrors.signInFailed });
        return;
      }
      showErrors({ email: failure.message });
    });
  });
  return card;
}

export function mountSignup(root: HTMLElement): void {
  root.replaceChildren(
    accountForm(
      'Sign up',
      [
        { name: 'name', label: 'Name', type: 'text' },
        { name: 'email', label: 'Email', type: 'email' },
        { name: 'password', label: 'Password', type: 'password' },
      ],
      'Sign up',
      { href: withNext('/signin'), text: 'Already have an account? Sign in' },
      async (values) => {
        await api.post('/api/auth/signup', values);
        window.location.assign(nextPath());
      },
    ),
  );
}

export function mountSignin(root: HTMLElement): void {
  root.replaceChildren(
    accountForm(
      'Sign in',
      [
        { name: 'email', label: 'Email', type: 'email' },
        { name: 'password', label: 'Password', type: 'password' },
      ],
      'Sign in',
      { href: withNext('/signup'), text: 'Need an account? Sign up' },
      async (values) => {
        await api.post('/api/auth/signin', values);
        window.location.assign(nextPath());
      },
    ),
  );
}

interface MeResponse {
  user: { id: string; name: string; email: string };
  workspaces: { id: string; name: string; slug: string; role: Role }[];
}

export async function mountWorkspaces(root: HTMLElement): Promise<void> {
  const me = await api.get<MeResponse>('/api/me');
  const list = el(
    'ul',
    { class: 'workspace-list' },
    me.workspaces.map((workspace) =>
      el('li', {}, [
        el('a', { href: `/w/${workspace.id}/edit` }, [workspace.name]),
        el('span', { class: 'mono role' }, [workspace.role]),
      ]),
    ),
  );
  const input = el('input', { type: 'text', id: 'workspace-name', 'aria-label': 'Workspace name' });
  const form = el('form', { class: 'create-workspace' }, [
    el('label', { for: 'workspace-name' }, ['Workspace name']),
    input,
    el('button', { type: 'submit', class: 'primary' }, ['Create workspace']),
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void api
      .post<{ id: string }>('/api/workspaces', { name: input.value })
      .then((created) => {
        window.location.assign(`/w/${created.id}/edit`);
      });
  });
  root.replaceChildren(
    el('main', { class: 'workspaces-page' }, [el('h1', {}, ['Workspaces']), list, form]),
  );
}
