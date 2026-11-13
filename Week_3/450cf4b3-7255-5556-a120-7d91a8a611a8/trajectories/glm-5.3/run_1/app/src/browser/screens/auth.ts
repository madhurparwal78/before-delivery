import { api, state, el, clear } from '../lib.js';
import { announce } from '../live.js';
import { validNext, showScreen } from '../app.js';

// Sign in and Apply: narrow centred forms on the paper ground. The browser's
// own validation never answers; the server does.

export async function renderSignIn(app: HTMLElement, url: URL, nextOverride: string): Promise<void> {
  const next = nextOverride !== '' ? nextOverride : url.searchParams.get('next') ?? '';
  const form = el('form', { 'aria-label': 'Sign in', class: 'auth-form' }) as HTMLFormElement;
  const email = el('input', { type: 'email', name: 'email', id: 'signin-email' }) as HTMLInputElement;
  const password = el('input', { type: 'password', name: 'password', id: 'signin-password' }) as HTMLInputElement;
  const status = el('p', { class: 'form-status', 'aria-live': 'polite' });

  form.append(
    el('label', { for: 'signin-email' }, 'Email'),
    email,
    el('label', { for: 'signin-password' }, 'Password'),
    password,
    el('button', { type: 'submit', class: 'btn btn-primary' }, 'Sign in'),
    el('a', { href: '/apply', class: 'apply-link' }, 'Apply for a station'),
    status,
  );

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    status.textContent = 'Signing in…';
    const r = await api('POST', '/api/session', { body: { email: email.value, password: password.value } });
    if (r.status === 200 && r.ok) {
      state.me = (r.ok as { user: typeof state.me }).user;
      state.sessionId = state.me!.id;
      const dest = validNext(next, state.me!.role);
      const target = dest ?? '/board';
      history.replaceState(null, '', target);
      await showScreen(app);
      return;
    }
    if (r.fail && r.fail.status === 401) {
      status.textContent = "That email and password don't match an account.";
      announce("That email and password don't match an account.");
      return;
    }
    if (r.fail && r.fail.status === 429) {
      const seconds = r.headers.get('Retry-After') ?? '';
      void seconds;
      status.textContent = 'Too many sign-in attempts for that email. Try again in a few minutes.';
      announce('Too many sign-in attempts for that email. Try again in a few minutes.');
      return;
    }
    if (r.fail && r.fail.status === 422 && r.fail.body?.fields) {
      const count = Object.keys(r.fail.body.fields).length;
      const copy = count === 1 ? '1 field needs attention.' : `${count} fields need attention.`;
      status.textContent = copy;
      announce(copy);
      return;
    }
    status.textContent = "Couldn't reach the kitchen. Nothing changed; try again.";
    announce("Couldn't reach the kitchen. Nothing changed; try again.");
  });

  const wrap = el('div', { class: 'auth-wrap' },
    el('h1', { class: 'screen-heading' }, 'Sign in to Stationhouse'),
    el('div', { class: 'auth-brand' }, 'Stationhouse'),
    form,
  );
  clear(app);
  app.appendChild(wrap);
  email.focus();
}

export async function renderApply(app: HTMLElement, url: URL): Promise<void> {
  void url;
  const form = el('form', { 'aria-label': 'Apply', class: 'auth-form' }) as HTMLFormElement;
  const fields: Array<{ key: string; label: string; type: string }> = [
    { key: 'businessName', label: 'Business name', type: 'text' },
    { key: 'contactName', label: 'Contact name', type: 'text' },
    { key: 'email', label: 'Email', type: 'email' },
    { key: 'password', label: 'Password', type: 'password' },
  ];
  const inputs: Record<string, HTMLInputElement> = {};
  const errorsWrap = el('div', { class: 'check-these', role: 'group', 'aria-label': 'Check these fields', hidden: '' });
  const fieldErrors: Record<string, HTMLElement> = {};

  for (const f of fields) {
    const input = el('input', { type: f.type, id: `apply-${f.key}`, name: f.key }) as HTMLInputElement;
    const err = el('p', { class: 'field-error', id: `apply-${f.key}-error`, hidden: '' });
    input.setAttribute('aria-describedby', err.id);
    inputs[f.key] = input;
    fieldErrors[f.key] = err;
    form.append(el('label', { for: input.id }, f.label), input, err);
  }
  const status = el('p', { class: 'form-status', 'aria-live': 'polite' });

  form.append(
    el('button', { type: 'submit', class: 'btn btn-primary' }, 'Send application'),
    status,
  );

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    errorsWrap.hidden = true;
    clear(errorsWrap);
    for (const key of Object.keys(fieldErrors)) {
      fieldErrors[key].hidden = true;
      fieldErrors[key].textContent = '';
    }
    status.textContent = 'Sending application…';
    const body = {
      businessName: inputs.businessName.value,
      contactName: inputs.contactName.value,
      email: inputs.email.value,
      password: inputs.password.value,
    };
    const r = await api('POST', '/api/tenants/apply', { body });
    if (r.status === 201 && r.ok) {
      state.me = (r.ok as { user: typeof state.me }).user;
      state.sessionId = state.me!.id;
      announce('Application received. Upload your certificate of insurance and food-handler card next.');
      history.replaceState(null, '', '/documents');
      await showScreen(app);
      const heading = app.querySelector('h1');
      if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.focus();
      }
      return;
    }
    if (r.fail && (r.fail.status === 422 || (r.fail.status === 409 && r.fail.body?.error === 'email_taken')) && r.fail.body) {
      const fb = r.fail.body;
      const fieldMessages: Record<string, string> = {};
      if (fb.error === 'email_taken') {
        fieldMessages.email = fb.message;
      } else if (fb.fields) {
        for (const [k, v] of Object.entries(fb.fields)) fieldMessages[k] = v;
      }
      const failing = fields.filter((f) => fieldMessages[f.key]);
      const count = failing.length;
      const countCopy = count === 1 ? '1 field needs attention.' : `${count} fields need attention.`;
      status.textContent = '';
      announce(countCopy);
      for (const f of failing) {
        const msg = fieldMessages[f.key];
        const link = el('a', { href: '#', class: 'field-link' }, `${f.label}: ${msg}`);
        link.addEventListener('click', (e) => {
          e.preventDefault();
          inputs[f.key].focus();
        });
        errorsWrap.appendChild(link);
        fieldErrors[f.key].textContent = msg;
        fieldErrors[f.key].hidden = false;
      }
      errorsWrap.hidden = false;
      errorsWrap.setAttribute('tabindex', '-1');
      errorsWrap.focus();
      return;
    }
    status.textContent = "Couldn't reach the kitchen. Nothing changed; try again.";
    announce("Couldn't reach the kitchen. Nothing changed; try again.");
  });

  const wrap = el('div', { class: 'auth-wrap' },
    el('h1', { class: 'screen-heading' }, 'Apply for a station'),
    errorsWrap,
    form,
  );
  errorsWrap.parentElement?.removeChild(errorsWrap);
  wrap.insertBefore(errorsWrap, form);
  clear(app);
  app.appendChild(wrap);
  inputs.businessName.focus();
}
