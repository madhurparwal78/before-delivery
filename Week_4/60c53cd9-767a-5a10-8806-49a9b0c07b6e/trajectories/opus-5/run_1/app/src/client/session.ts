/** The signed-in account, the sign-in dialog and its create-account mode. */

import { del, get, post } from './api';
import { announce, closeLayer, el, openLayer } from './dom';
import type { Account, ApiErrorBody } from '../shared/types';

let account: Account | null = null;
const listeners = new Set<() => void>();

export function currentAccount(): Account | null {
  return account;
}

export function onAccountChange(listener: () => void): void {
  listeners.add(listener);
}

function publish(): void {
  for (const listener of listeners) listener();
}

export function setAccount(next: Account | null): void {
  account = next;
  publish();
}

export async function loadSession(): Promise<Account | null> {
  const result = await get<{ account: Account }>('/api/session');
  account = result.ok && result.data ? result.data.account : null;
  publish();
  return account;
}

export async function signOut(): Promise<void> {
  await del('/api/session');
  setAccount(null);
  announce('Signed out.');
}

export interface SignInOptions {
  /** `Sign in to hold` when the buyer pressed Hold this home or their session ran out. */
  forHold?: boolean;
  email?: string;
  focusPassword?: boolean;
  returnFocus?: HTMLElement | null;
  onSignedIn: (account: Account) => void;
  onEscape?: () => void;
}

type Mode = 'sign-in' | 'create';

export function openSignInDialog(options: SignInOptions): HTMLElement {
  const dialog = el('div', { class: 'dialog-layer' });
  let mode: Mode = 'sign-in';
  let email = options.email ?? '';

  const render = (notice?: string): void => {
    const title = mode === 'create' ? 'Create an account' : options.forHold ? 'Sign in to hold' : 'Sign in';
    const heading = el('h2', { class: 'dialog-title', id: 'sign-in-title', text: title });
    const message = el('p', { class: 'dialog-notice', role: 'none' }, [notice ?? '']);
    const nameField = field('Name', 'text', '');
    const emailField = field('Email', 'email', email);
    const passwordField = field('Password', 'password', '');
    const submit = el('button', {
      type: 'submit',
      class: 'action action-primary',
      text: mode === 'create' ? 'Create account' : 'Sign in',
    });
    const switchMode = el('button', {
      type: 'button',
      class: 'action action-quiet',
      text: mode === 'create' ? 'I have an account' : 'Create an account',
      onclick: () => {
        mode = mode === 'create' ? 'sign-in' : 'create';
        email = emailField.input.value;
        render();
      },
    });

    const form = el('form', { class: 'dialog-form', novalidate: true }, [
      heading,
      message,
      mode === 'create' ? nameField.wrapper : null,
      emailField.wrapper,
      passwordField.wrapper,
      el('div', { class: 'dialog-actions' }, [submit, switchMode]),
    ]);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void send();
    });

    const send = async (): Promise<void> => {
      submit.disabled = true;
      submit.textContent = mode === 'create' ? 'Creating...' : 'Signing in...';
      for (const entry of [nameField, emailField, passwordField]) entry.setError(null);
      if (mode === 'create') {
        const result = await post<{ message: string }>('/api/accounts', {
          body: {
            name: nameField.input.value,
            email: emailField.input.value,
            password: passwordField.input.value,
          },
        });
        submit.disabled = false;
        submit.textContent = 'Create account';
        if (result.ok && result.data) {
          mode = 'sign-in';
          email = emailField.input.value;
          render(result.data.message);
          return;
        }
        showFieldErrors(result.error, { name: nameField, email: emailField, password: passwordField });
        return;
      }
      const result = await post<{ account: Account }>('/api/session', {
        body: { email: emailField.input.value, password: passwordField.input.value },
      });
      submit.disabled = false;
      submit.textContent = 'Sign in';
      if (result.ok && result.data) {
        setAccount(result.data.account);
        closeLayer(dialog, false);
        announce('Signed in.');
        options.onSignedIn(result.data.account);
        return;
      }
      if (result.error) {
        if (result.status === 422) {
          showFieldErrors(result.error, { email: emailField, password: passwordField });
        } else {
          message.textContent = result.error.message;
        }
      }
    };

    const panel = el('div', {
      class: 'dialog dialog-sign-in',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': title,
    }, [form]);
    dialog.replaceChildren(panel);
    const focusTarget = mode === 'create'
      ? nameField.input
      : options.focusPassword && email !== ''
        ? passwordField.input
        : emailField.input;
    focusTarget.focus();
  };

  render();
  document.getElementById('app')?.append(dialog);
  openLayer({
    node: dialog,
    returnFocus: options.returnFocus ?? null,
    onEscape: () => {
      closeLayer(dialog);
      options.onEscape?.();
    },
    initialFocus: () => dialog.querySelector<HTMLElement>('input'),
  });
  return dialog;
}

interface Field {
  wrapper: HTMLElement;
  input: HTMLInputElement;
  setError: (message: string | null) => void;
}

function field(label: string, type: string, value: string): Field {
  const id = `field-${label.toLowerCase()}`;
  const input = el('input', { id, type, class: 'input', value, autocomplete: 'off' }) as HTMLInputElement;
  const error = el('p', { class: 'field-error', id: `${id}-error` });
  const wrapper = el('div', { class: 'field' }, [el('label', { for: id, text: label }), input, error]);
  return {
    wrapper,
    input,
    setError: (message) => {
      error.textContent = message ?? '';
      if (message) {
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', `${id}-error`);
      } else {
        input.removeAttribute('aria-invalid');
        input.removeAttribute('aria-describedby');
      }
    },
  };
}

function showFieldErrors(
  error: ApiErrorBody['error'] | null,
  fields: Partial<Record<'name' | 'email' | 'password', Field>>,
): void {
  const given = error?.fields ?? {};
  for (const [name, entry] of Object.entries(fields)) {
    if (!entry) continue;
    entry.setError(given[name] ?? null);
  }
  if (error && Object.keys(given).length === 0 && fields.password) {
    fields.password.setError(error.message);
  }
}
