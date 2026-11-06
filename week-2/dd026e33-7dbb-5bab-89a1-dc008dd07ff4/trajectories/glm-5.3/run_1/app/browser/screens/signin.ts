/**
 * Sign-in screen — one centred form; after sign-in the return address or the
 * role's home opens.
 */
import { api, ApiFailure, NoAnswer } from '../api.ts';
import { state } from '../state.ts';
import { announce, h } from '../ui.ts';
import { SIGN_IN_WRONG } from '../../shared/copy.ts';
import { route } from '../app.ts';

export async function renderSignIn(root: HTMLElement): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const revoked = params.get('revoked') === '1';
  const next = params.get('next') ?? '';
  const email = h('input', { type: 'email', autocomplete: 'username', 'data-field': 'email' });
  const password = h('input', { type: 'password', autocomplete: 'current-password', 'data-field': 'password' });
  const summaryRegion = h('div', { 'data-summary': 'errors' });
  const pendingRegion = h('p', { class: 'status-region', role: 'status' });
  const submit = h('button', { class: 'primary', type: 'submit', text: 'Sign in' });
  const form = h('form', {
    onsubmit: async (event: Event) => {
      event.preventDefault();
      const fields: Record<string, string> = {};
      if (email.value.trim() === '' || password.value === '') {
        fields['email'] = 'Enter your email and password.';
        fields['password'] = 'Enter your email and password.';
      }
      if (Object.keys(fields).length > 0) {
        summaryRegion.replaceChildren(buildSummary(fields));
        return;
      }
      summaryRegion.replaceChildren();
      announce(pendingRegion, 'Signing in...');
      submit.disabled = true;
      try {
        const response = (await api.postQuiet('/api/session', {
          email: email.value.trim(),
          password: password.value,
          next: next || undefined,
        })) as { user: typeof state.me; redirect: string };
        state.me = response.user;
        await loadUnits();
        submit.disabled = false;
        window.history.replaceState({}, '', response.redirect);
        await route();
      } catch (err) {
        submit.disabled = false;
        if (err instanceof NoAnswer) {
          announce(pendingRegion, 'No answer from the server. Try again.');
          return;
        }
        if (err instanceof ApiFailure) {
          const fields = err.detail.fields ?? { email: SIGN_IN_WRONG };
          summaryRegion.replaceChildren(buildSummary(fields));
        }
      }
    },
  });
  form.append(
    h('div', { class: 'field' }, h('label', { text: 'Email' }), email),
    h('div', { class: 'field' }, h('label', { text: 'Password' }), password),
    summaryRegion,
    pendingRegion,
    submit,
  );
  root.replaceChildren(
    h('main', { class: 'stack' },
      h('div', { class: 'panel', style: 'max-width:420px;margin:48px auto;' },
        h('h1', { text: 'Sign in to Lacquer' }),
        revoked
          ? h('div', { role: 'alert' }, h('p', { class: 'error', text: 'Your access has been revoked.' }))
          : null,
        form)),
  );
  email.focus();
}

function buildSummary(fields: Record<string, string>): HTMLElement {
  return h('div', { role: 'alert' },
    h('p', { class: 'error-summary', text: 'There is a problem' }),
    h('ul', null,
      ...Object.entries(fields).map(([field, message]) =>
        h('li', null, h('a', {
          href: '#',
          text: message,
          onclick: (event: Event) => {
            event.preventDefault();
            const control = document.querySelector<HTMLElement>(`[data-field="${field}"]`);
            control?.focus();
          },
        })))));
}

async function loadUnits(): Promise<void> {
  try {
    const response = (await api.getQuiet('/api/me')) as { units: typeof state.units };
    state.units = response.units;
  } catch {
    // defaults stand
  }
}
