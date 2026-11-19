import { api, ApiRequestError, type Staff } from '../api.js';
import { setStaff } from '../main.js';

export function renderSignIn(app: HTMLElement): void {
  app.replaceChildren();
  const shell = document.createElement('div');
  shell.className = 'signin';
  const card = document.createElement('div');
  card.className = 'signin-card';

  const h = document.createElement('h1');
  h.textContent = 'Spanwise';
  card.append(h);

  const form = document.createElement('form');
  const code = document.createElement('input');
  code.type = 'text';
  code.id = 'access-code';
  code.setAttribute('aria-label', 'Access code');
  code.name = 'access_code';
  code.autocomplete = 'off';
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.textContent = 'Sign in';
  const status = document.createElement('p');
  status.id = 'sign-in-status';
  status.setAttribute('role', 'status');
  status.className = 'status-line';
  status.textContent = '';
  form.append(code, submit);
  card.append(form, status);
  shell.append(card);
  app.append(shell);
  code.focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.textContent = 'Signing in...';
    submit.setAttribute('aria-disabled', 'true');
    try {
      const r = await api<{ staff: Staff }>('/api/session', {
        method: 'POST',
        body: JSON.stringify({ access_code: code.value }),
      });
      setStaff(r.staff);
      status.textContent = '';
      location.replace('/corridors');
    } catch (err) {
      submit.textContent = 'Sign in';
      submit.removeAttribute('aria-disabled');
      if (err instanceof ApiRequestError) {
        if (err.fields['access_code']) {
          status.textContent = err.fields['access_code'];
        } else {
          status.textContent = err.message;
        }
      } else {
        status.textContent = 'That access code is not recognised.';
      }
    }
  });
}
