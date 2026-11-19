import { copy } from '../shared/copy.js';
import { ApiRequestError, api } from './api.js';
import { announce, announcer } from './announcer.js';
import { h, mount } from './dom.js';

/**
 * Where `next` sends people after signing in or up. It must be a path starting with a
 * single `/`; anything else sends them to `/`.
 */
export function safeNext(raw: string | null): string {
  if (raw === null || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

export function nextFromAddress(): string {
  return safeNext(new URL(window.location.href).searchParams.get('next'));
}

export function signInPath(next: string): string {
  return next === '/' ? '/signin' : `/signin?next=${encodeURIComponent(next)}`;
}

interface FieldSpec {
  name: string;
  label: string;
  type: string;
}

function form(
  specs: readonly FieldSpec[],
  submitLabel: string,
  submit: (values: Record<string, string>, fail: (fields: Record<string, string>) => void) => void,
): HTMLElement {
  const inputs = new Map<string, HTMLInputElement>();
  const errors = new Map<string, HTMLElement>();
  const summary = h('div', { class: 'form-summary', role: 'alert', hidden: true });
  const rows: HTMLElement[] = [summary];
  for (const spec of specs) {
    const input = h('input', {
      class: 'field-input',
      type: spec.type,
      id: `field-${spec.name}`,
      'aria-label': spec.label,
      autocomplete: spec.type === 'password' ? 'current-password' : 'on',
    });
    const error = h('p', { class: 'field-error', id: `error-${spec.name}`, hidden: true });
    inputs.set(spec.name, input);
    errors.set(spec.name, error);
    rows.push(
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: `field-${spec.name}` }, spec.label, input), error),
    );
  }
  const fail = (fields: Record<string, string>): void => {
    summary.hidden = false;
    mount(
      summary,
      h('p', {}, 'Check these fields:'),
      ...Object.entries(fields).map(([name, message]) =>
        h('a', { href: `#field-${name}` }, `${name}: ${message}`),
      ),
    );
    for (const [name, error] of errors) {
      const message = fields[name];
      error.hidden = message === undefined;
      error.textContent = message ?? '';
      inputs.get(name)?.setAttribute('aria-invalid', message === undefined ? 'false' : 'true');
    }
    announce(Object.values(fields).join(' '));
  };
  const button = h('button', { class: 'primary-button', type: 'submit' }, submitLabel);
  const element = h('form', { class: 'auth-form' }, ...rows, button);
  element.addEventListener('submit', (event) => {
    event.preventDefault();
    summary.hidden = true;
    const values: Record<string, string> = {};
    for (const [name, input] of inputs) values[name] = input.value;
    submit(values, fail);
  });
  return element;
}

export function signInScreen(host: HTMLElement, onSignedIn: (next: string) => void): void {
  const next = nextFromAddress();
  mount(
    host,
    h(
      'main',
      { class: 'auth-screen' },
      h('h1', { class: 'auth-title' }, 'Sign in to Linewell'),
      form(
        [
          { name: 'email', label: 'Email', type: 'email' },
          { name: 'password', label: 'Password', type: 'password' },
        ],
        'Sign in',
        (values, fail) => {
          void api
            .signIn(values['email'] ?? '', values['password'] ?? '')
            .then(() => onSignedIn(next))
            .catch((error: unknown) => {
              if (error instanceof ApiRequestError && error.failure.fields) fail(error.failure.fields);
              else fail({ password: copy.signInError });
            });
        },
      ),
      h(
        'a',
        { class: 'auth-link', href: next === '/' ? '/signup' : `/signup?next=${encodeURIComponent(next)}` },
        'Create an account',
      ),
      announcer(),
    ),
  );
}

export function signUpScreen(host: HTMLElement, onSignedIn: (next: string) => void): void {
  const next = nextFromAddress();
  mount(
    host,
    h(
      'main',
      { class: 'auth-screen' },
      h('h1', { class: 'auth-title' }, 'Create your Linewell account'),
      form(
        [
          { name: 'name', label: 'Name', type: 'text' },
          { name: 'email', label: 'Email', type: 'email' },
          { name: 'password', label: 'Password', type: 'password' },
        ],
        'Create account',
        (values, fail) => {
          void api
            .signUp(values['name'] ?? '', values['email'] ?? '', values['password'] ?? '')
            .then(() => onSignedIn(next))
            .catch((error: unknown) => {
              if (error instanceof ApiRequestError && error.failure.fields) fail(error.failure.fields);
              else fail({ email: copy.fieldErrors.email });
            });
        },
      ),
      h('a', { class: 'auth-link', href: signInPath(next) }, 'Sign in instead'),
      announcer(),
    ),
  );
}

export function diagramListScreen(
  host: HTMLElement,
  open: (path: string) => void,
  onUnauthenticated: () => void,
): void {
  const list = h('ul', { class: 'diagram-list', role: 'list' });
  const error = h('p', { class: 'field-error', hidden: true });
  const create = h('button', { class: 'primary-button', type: 'button' }, 'New diagram');
  // A textarea so a pasted or typed line break reaches the title rule rather than being
  // silently stripped by a single-line input.
  const titleField = h('textarea', {
    class: 'field-input title-field',
    rows: '1',
    'aria-label': 'Title',
  });
  create.addEventListener('click', () => {
    const title = titleField.value;
    void api
      .createDiagram(title)
      .then((result) => open(`/d/${result.diagram.id}`))
      .catch((caught: unknown) => {
        const message =
          caught instanceof ApiRequestError
            ? caught.failure.fields?.['title'] ?? copy.fieldErrors.title
            : copy.fieldErrors.title;
        error.hidden = false;
        error.textContent = message;
        titleField.setAttribute('aria-invalid', 'true');
        announce(message);
      });
  });
  mount(
    host,
    h(
      'main',
      { class: 'list-screen' },
      h('h1', { class: 'auth-title' }, 'Your diagrams'),
      h('div', { class: 'new-diagram' }, h('label', { class: 'field-label' }, 'Title', titleField), create),
      error,
      list,
      announcer(),
    ),
  );
  void api
    .diagrams()
    .then((result) => {
      if (result.diagrams.length === 0) {
        mount(list, h('li', { class: 'empty-list' }, copy.emptyDiagramList));
        return;
      }
      mount(
        list,
        ...result.diagrams.map((diagram) =>
          h('li', {}, h('a', { class: 'diagram-link', href: `/d/${diagram.id}` }, diagram.title)),
        ),
      );
      for (const link of list.querySelectorAll('a')) {
        link.addEventListener('click', (event) => {
          event.preventDefault();
          open(link.getAttribute('href') ?? '/');
        });
      }
    })
    .catch((caught: unknown) => {
      if (caught instanceof ApiRequestError && caught.failure.status === 401) onUnauthenticated();
    });
}

export function notFoundScreen(host: HTMLElement): void {
  mount(
    host,
    h(
      'main',
      { class: 'not-found' },
      h('h1', { class: 'auth-title' }, copy.notFoundHeading),
      h('p', {}, copy.notFoundText),
      h('a', { class: 'auth-link', href: '/' }, 'Your diagrams'),
      announcer(),
    ),
  );
}
