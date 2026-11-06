import { ApiRequestError, api } from '../api';
import { LiveRegion } from '../components';
import { clear, h } from '../dom';
import { SESSION_ENDED_KEY, safeNextPath } from '../next-path';
import type { Screen, ScreenContext } from '../screen';

const SESSION_ENDED_COPY =
  'Your session ended. Sign in again to finish this booking. Nothing was charged.';

interface Field {
  readonly key: string;
  readonly label: string;
  readonly type: string;
  readonly input: HTMLInputElement;
  readonly error: HTMLElement;
}

function field(key: string, label: string, type: string): Field {
  const id = `auth-${key}`;
  const input = h('input', { type, id, name: key, autocomplete: 'off' });
  const error = h('p', { class: 'field-error' });
  return { key, label, type, input, error };
}

function fieldRow(entry: Field): HTMLElement {
  return h('div', { class: 'field' }, [
    h('label', { for: entry.input.id }, [entry.label]),
    entry.input,
    entry.error,
  ]);
}

function showErrors(fields: readonly Field[], errors: Record<string, string>): void {
  for (const entry of fields) {
    entry.error.textContent = errors[entry.key] ?? '';
  }
}

function problemRegion(): LiveRegion {
  return new LiveRegion('Sign-in problem', 'alert', 'alert');
}

export async function renderSignIn(context: ScreenContext): Promise<Screen> {
  const { main, router, url } = context;
  const next = url.searchParams.get('next');
  const problem = problemRegion();
  const email = field('email', 'Email', 'email');
  const password = field('password', 'Password', 'password');
  const fields = [email, password];

  const form = h('form', { class: 'panel stack' }, [
    h('h1', {}, ['Sign in']),
    problem.element,
    fieldRow(email),
    fieldRow(password),
    h('button', { type: 'submit', class: 'btn' }, ['Sign in']),
  ]);

  const createLink = h('a', {
    href: next === null ? '/register' : `/register?next=${encodeURIComponent(next)}`,
  }, ['Create account']);
  createLink.addEventListener('click', (event) => {
    event.preventDefault();
    router.go(createLink.getAttribute('href') ?? '/register');
  });
  form.appendChild(h('p', {}, [createLink]));

  if (sessionStorage.getItem(SESSION_ENDED_KEY) === '1') {
    sessionStorage.removeItem(SESSION_ENDED_KEY);
    problem.say(SESSION_ENDED_COPY);
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    showErrors(fields, {});
    void api.signIn(email.input.value, password.input.value)
      .then((account) => {
        context.state.account = account;
        router.refreshNav();
        router.go(safeNextPath(next));
      })
      .catch((error: unknown) => {
        if (!(error instanceof ApiRequestError)) throw error;
        if (error.payload.error === 'validation') {
          showErrors(fields, error.payload.errors ?? {});
          return;
        }
        problem.say('Email or password is wrong.');
      });
  });

  clear(main);
  main.appendChild(form);
  return { ribbon: [] };
}

export async function renderRegister(context: ScreenContext): Promise<Screen> {
  const { main, router, url } = context;
  const next = url.searchParams.get('next');
  const problem = problemRegion();
  const name = field('name', 'Full name', 'text');
  const email = field('email', 'Email', 'email');
  const phone = field('phone', 'Mobile number', 'tel');
  const password = field('password', 'Password', 'password');
  const fields = [name, email, phone, password];

  const form = h('form', { class: 'panel stack' }, [
    h('h1', {}, ['Create account']),
    problem.element,
    fieldRow(name),
    fieldRow(email),
    fieldRow(phone),
    fieldRow(password),
    h('button', { type: 'submit', class: 'btn' }, ['Create account']),
  ]);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    showErrors(fields, {});
    void api.createAccount({
      name: name.input.value,
      email: email.input.value,
      phone: phone.input.value,
      password: password.input.value,
    })
      .then((account) => {
        context.state.account = account;
        router.refreshNav();
        router.go(safeNextPath(next));
      })
      .catch((error: unknown) => {
        if (!(error instanceof ApiRequestError)) throw error;
        if (error.payload.error === 'validation') {
          showErrors(fields, error.payload.errors ?? {});
          return;
        }
        if (error.payload.error === 'email_taken') {
          problem.say('An account already uses this email.');
          return;
        }
        problem.say('Email or password is wrong.');
      });
  });

  clear(main);
  main.appendChild(form);
  return { ribbon: [] };
}
