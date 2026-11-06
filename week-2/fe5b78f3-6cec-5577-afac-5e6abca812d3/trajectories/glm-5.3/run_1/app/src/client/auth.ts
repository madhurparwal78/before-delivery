// Sign in and Create account, with the safe `next` return path.

import { api, ApiFail } from './api.js';
import { el, setAlert, clearAlert, setAccount, nextId } from './ui.js';
import { renderShell, setTitle } from './shell.js';

/**
 * The return-path rule. The query value has already been percent-decoded once
 * by the query parser, so it is inspected as it stands.
 */
export function safeNext(next: string | null): string | null {
  if (next === null) return null;
  if (!next.startsWith('/')) return INVALID_NEXT;
  if (next.length > 1 && (next[1] === '/' || next[1] === '\\')) return INVALID_NEXT;
  if (next.includes('\\')) return INVALID_NEXT;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(next)) return INVALID_NEXT;
  return next;
}

const INVALID_NEXT = '/'; // a `next` that is present but not accepted lands on /
const BOOKINGS_LANDING = '/bookings'; // no `next` lands on My bookings

function landingPath(nextParam: string | null): string {
  const next = safeNext(nextParam);
  if (next === null) return BOOKINGS_LANDING;
  return next;
}

function problemAlertCopy(body: ApiFail['body']): string {
  if (body.error === 'invalid_credentials') return 'Email or password is wrong.';
  if (body.error === 'email_taken') return 'An account already uses this email.';
  if (body.errors) {
    const first = Object.values(body.errors)[0];
    if (first) return first;
  }
  return 'Something went wrong. Try again.';
}

export function fieldErrorsList(body: ApiFail['body']): Record<string, string> {
  return body.errors ?? {};
}

export async function renderAuth(mode: 'signin' | 'register'): Promise<void> {
  setTitle(mode === 'signin' ? 'Sign in' : 'Create account');
  const params = new URLSearchParams(location.search);
  const nextParam = params.get('next');
  const main = el('main', { id: 'main' });
  renderShell(main);

  const h = el('h1', {}, mode === 'signin' ? 'Sign in' : 'Create account');
  main.appendChild(h);

  const form = el('form', { novalidate: 'novalidate' });
  const fields: { key: string; label: string; type: string; value?: string }[] =
    mode === 'signin'
      ? [
          { key: 'email', label: 'Email', type: 'email', value: '' },
          { key: 'password', label: 'Password', type: 'password', value: '' },
        ]
      : [
          { key: 'name', label: 'Full name', type: 'text', value: '' },
          { key: 'email', label: 'Email', type: 'email', value: '' },
          { key: 'phone', label: 'Mobile number', type: 'tel', value: '' },
          { key: 'password', label: 'Password', type: 'password', value: '' },
        ];

  const inputs: Record<string, HTMLInputElement> = {};
  for (const f of fields) {
    const row = el('div', { class: 'field' });
    const id = nextId('f');
    const label = el('label', { for: id }, f.label);
    const input = el('input', { id, name: f.key, type: f.type, autocomplete: 'off' });
    input.setAttribute('aria-label', f.label);
    inputs[f.key] = input;
    row.appendChild(label);
    row.appendChild(input);
    const err = el('div', { class: 'field-error', 'data-err': f.key });
    row.appendChild(err);
    form.appendChild(row);
  }

  const submit = el('button', { class: 'btn-primary', type: 'submit' },
    mode === 'signin' ? 'Sign in' : 'Create account');
  form.appendChild(submit);
  main.appendChild(form);

  if (mode === 'signin' && params.get('ended') === '1') {
    setAlert('Sign-in problem', '<p>Your session ended. Sign in again to finish this booking. Nothing was charged.</p>');
  }

  if (mode === 'signin') {
    const p = el('p');
    const nextEnc = nextParam ? `?next=${encodeURIComponent(nextParam)}` : '';
    p.appendChild(el('a', { href: `/register${nextEnc}` }, 'Create account'));
    main.appendChild(p);
  } else {
    const p = el('p');
    const nextEnc = nextParam ? `?next=${encodeURIComponent(nextParam)}` : '';
    p.appendChild(el('a', { href: `/signin${nextEnc}` }, 'Sign in'));
    main.appendChild(p);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAlert('Sign-in problem');
    const body: Record<string, string> = {};
    for (const f of fields) body[f.key] = inputs[f.key].value;
    try {
      const account = await api<never>(
        'POST',
        mode === 'signin' ? '/api/session' : '/api/accounts',
        body,
      );
      setAccount(account as never);
      sessionStorage.clear();
      location.href = landingPath(nextParam);
    } catch (err) {
      if (err instanceof ApiFail) {
        const copy = problemAlertCopy(err.body);
        setAlert('Sign-in problem', `<p>${copy}</p>`);
        for (const [k, v] of Object.entries(fieldErrorsList(err.body))) {
          const target = form.querySelector<HTMLElement>(`[data-err="${k}"]`);
          if (target) target.textContent = v;
        }
      }
    }
  });
}
