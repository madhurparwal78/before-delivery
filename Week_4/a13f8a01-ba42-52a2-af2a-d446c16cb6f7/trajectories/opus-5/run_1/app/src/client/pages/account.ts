import type { ShelfEntry, User } from '../../shared/api';
import { copy } from '../../shared/copy';
import { api, ApiFailure } from '../api';
import { siteHeader } from '../components/shell';
import { h, replace } from '../dom';
import { mountPage } from '../layout';

const fullPage = (children: HTMLElement[]): HTMLElement =>
  h('div', { class: 'shell' }, [siteHeader(), h('main', { class: 'wide-main' }, children)]);

const field = (label: string, type: string): { wrap: HTMLElement; input: HTMLInputElement } => {
  const input = h('input', { type, 'aria-label': label, class: 'field', autocomplete: 'off' });
  return { wrap: h('label', { class: 'field-row' }, [h('span', { text: label }), input]), input };
};

const problemAlert = (
  fields: Record<string, string>,
  inputs: Record<string, HTMLInputElement>,
): HTMLElement =>
  h('div', { role: 'alert', class: 'panel panel-error' }, [
    h('h2', { text: copy.thereIsAProblem }),
    h(
      'ul',
      {},
      Object.entries(fields).map(([name, message]) =>
        h('li', {}, [
          h('a', {
            href: `#${name}`,
            text: message,
            onclick: (event: Event) => {
              event.preventDefault();
              inputs[name]?.focus();
            },
          }),
        ]),
      ),
    ),
  ]);

export const signupPage = (): void => {
  const handle = field('Handle', 'text');
  const email = field('Email', 'email');
  const password = field('Password', 'password');
  const alertHolder = h('div', { class: 'alert-holder' });
  const inputs = { handle: handle.input, email: email.input, password: password.input };

  const submit = async (): Promise<void> => {
    replace(alertHolder, []);
    try {
      const made = await api.post<{ user: User; verification: string }>('/api/signup', {
        handle: handle.input.value,
        email: email.input.value,
        password: password.input.value,
      });
      window.sessionStorage.setItem('ashlar.verification', made.verification);
      window.location.assign('/dashboard');
    } catch (error) {
      if (error instanceof ApiFailure && Object.keys(error.fields).length > 0) {
        replace(alertHolder, [problemAlert(error.fields, inputs)]);
        alertHolder.querySelector<HTMLElement>('a')?.focus();
        return;
      }
      throw error;
    }
  };

  mountPage(
    fullPage([
      h('h1', { text: 'Start a pen' }),
      alertHolder,
      h('form', { class: 'form', onsubmit: (event: Event) => {
        event.preventDefault();
        void submit();
      } }, [
        handle.wrap,
        email.wrap,
        password.wrap,
        h('button', { type: 'submit', class: 'action accent', text: 'Create account' }),
      ]),
    ]),
  );
};

export const signinPage = (): void => {
  const email = field('Email', 'email');
  const password = field('Password', 'password');
  const alertHolder = h('div', { class: 'alert-holder' });

  const submit = async (): Promise<void> => {
    replace(alertHolder, []);
    try {
      await api.post<{ user: User }>('/api/signin', {
        email: email.input.value,
        password: password.input.value,
      });
      window.location.assign('/dashboard');
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 401) {
        replace(alertHolder, [
          h('div', { role: 'alert', class: 'panel panel-error' }, [
            h('p', { text: copy.badCredentials }),
          ]),
        ]);
        return;
      }
      throw error;
    }
  };

  mountPage(
    fullPage([
      h('h1', { text: 'Sign in' }),
      alertHolder,
      h('form', { class: 'form', onsubmit: (event: Event) => {
        event.preventDefault();
        void submit();
      } }, [
        email.wrap,
        password.wrap,
        h('button', { type: 'submit', class: 'action accent', text: 'Sign in' }),
      ]),
    ]),
  );
};

export const verifyPage = async (): Promise<void> => {
  const token = new URL(window.location.href).searchParams.get('token') ?? '';
  const heading = h('h1', { text: '' });
  mountPage(fullPage([heading, h('a', { href: '/dashboard', text: 'Go to your dashboard' })]));
  try {
    await api.post<{ user: User }>('/api/verify', { token });
    heading.textContent = copy.verifyOk;
    window.sessionStorage.setItem('ashlar.verification', 'sent');
  } catch (error) {
    if (error instanceof ApiFailure && error.code === 'token_expired') {
      heading.textContent = copy.verifyExpired;
      return;
    }
    if (error instanceof ApiFailure && error.code === 'token_invalid') {
      heading.textContent = copy.verifyInvalid;
      return;
    }
    throw error;
  }
};

export const shelfPage = async (): Promise<void> => {
  const body = h('tbody');
  mountPage(
    fullPage([
      h('h1', { text: 'The shelf' }),
      h('table', { class: 'shelf-table', 'aria-label': 'Pinned libraries' }, [
        h('thead', {}, [
          h('tr', {}, [
            h('th', { scope: 'col', text: 'Library' }),
            h('th', { scope: 'col', text: 'Version' }),
            h('th', { scope: 'col', text: 'Global' }),
            h('th', { scope: 'col', text: 'Licence' }),
            h('th', { scope: 'col', text: 'Size (bytes)' }),
          ]),
        ]),
        body,
      ]),
    ]),
  );
  const libraries = (await api.get<{ libraries: ShelfEntry[] }>('/api/shelf')).libraries;
  replace(
    body,
    libraries.map((library) =>
      h('tr', {}, [
        h('td', { text: library.name }),
        h('td', { class: 'tabular', text: library.version }),
        h('td', { class: 'mono', text: library.global }),
        h('td', { text: library.license }),
        h('td', { class: 'tabular', text: String(library.bytes) }),
      ]),
    ),
  );
};
