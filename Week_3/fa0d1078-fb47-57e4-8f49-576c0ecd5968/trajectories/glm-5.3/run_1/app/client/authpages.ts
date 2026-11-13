import { el, announce } from './dom.js';
import { api, ApiError } from './api.js';
import { session } from './session.js';
import type { Player } from '../shared/api.js';
import * as M from '../shared/messages.js';

// The account pages: sign up, sign in, verify, reset request and reset
// confirm. Every form has an alert with the heading "Check these details"
// when a field is invalid, with one link per invalid field that moves focus
// to the field.

interface FieldSpec {
  name: string;
  label: string;
  type?: string;
  autocomplete?: string;
}

function field(spec: FieldSpec): { wrap: HTMLElement; input: HTMLInputElement; error: HTMLElement } {
  const input = el('input', {
    id: `field-${spec.name}`,
    name: spec.name,
    type: spec.type ?? 'text',
    autocomplete: spec.autocomplete,
  });
  const error = el('p', { class: 'field-error', id: `error-${spec.name}` }, []);
  input.setAttribute('aria-describedby', `error-${spec.name}`);
  const wrap = el('div', { class: 'field' }, [
    el('label', { for: `field-${spec.name}` }, [spec.label]),
    input,
    error,
  ]);
  return { wrap, input, error };
}

function alertBox(errors: Array<{ field: string; message: string }>, focus: (name: string) => void): HTMLElement {
  const alert = el('div', { class: 'form-alert', role: 'alert' }, [
    el('h2', {}, ['Check these details']),
  ]);
  const list = el('ul');
  for (const e of errors) {
    const link = el('a', { href: `#field-${e.field}` }, [e.message]);
    link.addEventListener('click', (event) => {
      event.preventDefault();
      focus(e.field);
    });
    list.append(el('li', {}, [link]));
  }
  alert.append(list);
  return alert;
}

function formTile(h1Text: string, fields: FieldSpec[], submitLabel: string, onSubmit: (values: Record<string, string>, show: (errors: Array<{ field: string; message: string }>) => void, notice: (sentence: string) => void, done: (btn: HTMLButtonElement) => void) => Promise<void>): HTMLElement {
  const inputs = new Map<string, { input: HTMLInputElement; error: HTMLElement }>();
  const tile = el('div', { class: 'tile form-tile' });
  const h1 = el('h1', {}, [h1Text]);
  const form = el('form', {});
  const alertHost = el('div', {});

  const btn = el('button', { class: 'button', type: 'submit' }, [submitLabel]);
  const notice = el('p', { class: 'form-result', role: 'status' }, []);

  function noticeSentence(sentence: string): void {
    notice.textContent = sentence;
  }

  function focusField(name: string): void {
    inputs.get(name)?.input.focus();
  }

  function showErrors(errors: Array<{ field: string; message: string }>): void {
    for (const e of errors) {
      const entry = inputs.get(e.field);
      if (entry) entry.error.textContent = e.message;
    }
    alertHost.replaceChildren(alertBox(errors, focusField));
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    btn.setAttribute('aria-disabled', 'true');
    const values: Record<string, string> = {};
    for (const [name, entry] of inputs.entries()) values[name] = entry.input.value;
    for (const entry of inputs.values()) entry.error.textContent = '';
    alertHost.replaceChildren();
    void onSubmit(values, showErrors, noticeSentence, (b) => b.setAttribute('aria-disabled', 'false'));
  });

  for (const spec of fields) {
    const f = field(spec);
    inputs.set(spec.name, { input: f.input, error: f.error });
    form.append(f.wrap);
  }
  form.append(btn);
  tile.append(h1, alertHost, form, notice);
  return tile;
}

function returnTo(): string {
  const params = new URLSearchParams(window.location.search);
  const target = params.get('return');
  return target && target.startsWith('/') ? target : '/';
}

export function renderSignUp(): HTMLElement {
  return formTile(
    'Create your account',
    [
      { name: 'email', label: 'Email', type: 'email', autocomplete: 'email' },
      { name: 'display_name', label: 'Display name', autocomplete: 'nickname' },
      { name: 'password', label: 'Password', type: 'password', autocomplete: 'new-password' },
    ],
    'Create account',
    async (values, show, noticeSentence, done) => {
      announce(M.m59Signup());
      try {
        const res = await api.post<{ player: Player; verification_sent: boolean }>('/api/auth/signup', values);
        session.setPlayer(res.player);
        if (!res.verification_sent) {
          // Mailpit is unreachable: the account is ready but no link exists.
          // The notice stays under the form so Send again can be used.
          announce(M.m49());
          noticeSentence(M.m49());
          done(document.querySelector('button[type="submit"]') as HTMLButtonElement);
          return;
        }
        window.location.href = returnTo() === '/' ? '/daily' : returnTo();
      } catch (err) {
        done(document.querySelector('button[type="submit"]') as HTMLButtonElement);
        if (err instanceof ApiError) {
          if (err.failure.fields) {
            show(Object.entries(err.failure.fields).map(([f, message]) => ({ field: f, message })));
          } else if (err.failure.code === 'STORAGE_UNAVAILABLE') {
            announce(M.m61());
          } else {
            announce(M.m56());
          }
        } else {
          announce(M.m56());
        }
      }
    },
  );
}

export function renderSignIn(): HTMLElement {
  return formTile(
    'Sign in',
    [
      { name: 'email', label: 'Email', type: 'email', autocomplete: 'email' },
      { name: 'password', label: 'Password', type: 'password', autocomplete: 'current-password' },
    ],
    'Sign in',
    async (values, show, noticeSentence, done) => {
      announce(M.m59Signin());
      try {
        const res = await api.post<{ player: Player }>('/api/auth/signin', values);
        session.setPlayer(res.player);
        window.location.href = returnTo();
      } catch (err) {
        done(document.querySelector('button[type="submit"]') as HTMLButtonElement);
        if (err instanceof ApiError) {
          if (err.failure.code === 'BAD_CREDENTIALS') {
            announce(M.m52());
            noticeSentence(M.m52());
            show([{ field: 'email', message: M.m52() }]);
          } else {
            announce(M.m56());
          }
        }
      }
    },
  );
}

export function renderVerify(token: string): HTMLElement {
  const tile = el('div', { class: 'tile form-tile' });
  const h1 = el('h1', {}, ['Confirm your email']);
  const result = el('p', { class: 'form-result', role: 'status' }, [M.m57()]);

  void api.post<{ player: { display_name: string; verified: boolean } }>('/api/auth/verify', { token }).then(() => {
    result.textContent = M.m53Verified();
    announce(M.m53Verified());
  }).catch((err: unknown) => {
    if (err instanceof ApiError) {
      const code = err.failure.code;
      if (code === 'TOKEN_USED') {
        result.textContent = M.m54Used();
        announce(M.m54Used());
      } else if (code === 'TOKEN_EXPIRED') {
        result.textContent = M.m54Expired();
        announce(M.m54Expired());
      } else {
        result.textContent = M.m54NotFound();
        announce(M.m54NotFound());
      }
    } else {
      result.textContent = M.m56();
      announce(M.m56());
    }
  });

  tile.append(h1, result);
  return tile;
}

export function renderResetRequest(): HTMLElement {
  return formTile(
    'Reset your password',
    [{ name: 'email', label: 'Email', type: 'email', autocomplete: 'email' }],
    'Send reset link',
    async (values, show, noticeSentence, done) => {
      announce(M.m59Reset());
      try {
        await api.post('/api/auth/reset', values);
        announce(M.m51());
        noticeSentence(M.m51());
      } catch (err) {
        done(document.querySelector('button[type="submit"]') as HTMLButtonElement);
        if (err instanceof ApiError) {
          if (err.failure.code === 'MAIL_UNAVAILABLE') {
            announce(M.m50());
            noticeSentence(M.m50());
          } else if (err.failure.fields) {
            show(Object.entries(err.failure.fields).map(([f, message]) => ({ field: f, message })));
          } else {
            announce(M.m56());
          }
        }
      }
    },
  );
}

export function renderResetConfirm(token: string): HTMLElement {
  return formTile(
    'Choose a new password',
    [{ name: 'password', label: 'New password', type: 'password', autocomplete: 'new-password' }],
    'Save password',
    async (values, show, noticeSentence, done) => {
      announce(M.m59Reset());
      try {
        const res = await api.post<{ player: Player }>('/api/auth/reset/confirm', { token, password: values['password'] });
        session.setPlayer(res.player);
        announce(M.m53Reset());
        window.location.href = '/';
      } catch (err) {
        done(document.querySelector('button[type="submit"]') as HTMLButtonElement);
        if (err instanceof ApiError) {
          const code = err.failure.code;
          if (code === 'TOKEN_USED') {
            announce(M.m55Used());
            noticeSentence(M.m55Used());
          } else if (code === 'TOKEN_EXPIRED') {
            announce(M.m55Expired());
            noticeSentence(M.m55Expired());
          } else if (code === 'TOKEN_NOT_FOUND') {
            announce(M.m55NotFound());
            noticeSentence(M.m55NotFound());
          } else if (err.failure.fields) {
            show(Object.entries(err.failure.fields).map(([f, message]) => ({ field: f, message })));
          } else {
            announce(M.m56());
          }
        }
      }
    },
  );
}
