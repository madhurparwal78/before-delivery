// The sign-in sheet.

import { api, ConnectionLost, field, figure, h, icon } from '../core.js';

export function mount(screen, main) {
  const next = new URLSearchParams(location.search).get('next');
  const email = h('input', { type: 'text', inputmode: 'email', autocomplete: 'username' });
  const password = h('input', { type: 'password', autocomplete: 'current-password' });
  const status = h('div', { role: 'alert', 'aria-label': 'Sign-in status', class: 'sign-in-status' });
  const show = (copy, refusal = true) => {
    status.classList.toggle('refusal', refusal);
    status.replaceChildren(...(refusal ? [icon('refuse')] : []), document.createTextNode(copy));
  };
  if (next !== null) show('Your session has ended.', false);

  const form = h('form', { class: 'stack sign-in-form', novalidate: true },
    field('Email', email),
    field('Password', password),
    status,
    h('button', { type: 'submit', class: 'btn' }, 'Sign in'));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = { email: email.value, password: password.value };
    if (next !== null) body.next = next;
    let answer;
    try {
      answer = await api('POST', '/api/sign-in', { body, quietSession: true });
    } catch (error) {
      if (!(error instanceof ConnectionLost)) throw error;
      show('Email or password is not right.');
      return;
    }
    if (answer.ok) {
      location.assign(answer.data.landing);
      return;
    }
    show(answer.error === 'sign_in_locked' ? 'Too many attempts. Try again later.' : 'Email or password is not right.');
    password.value = '';
    password.focus();
  });

  main.replaceChildren(
    h('main', { class: 'sign-in-sheet' },
      h('section', { class: 'sign-in-card' },
        figure('Custody and disclosure', 'Wardline'),
        h('p', { class: 'sign-in-lede' }, 'Ashgrove Custody Works. Sealed exhibits, separated sign-off and a ledger you can verify yourself.'),
        form)),
  );
  email.focus();
}
