/** The sign-in sheet. */

import { post } from './api.js';
import { el } from './dom.js';
import { go, landingFor, loadSession, state } from './app.js';

const FAILED = 'Email or password is not right.';
const LOCKED = 'Too many attempts. Try again later.';
const SESSION_ENDED = 'Your session has ended.';

export default {
  async mount(context) {
    if (state.user) {
      go(landingFor(state.user.role), true);
      return {};
    }
    const next = new URLSearchParams(window.location.search).get('next');
    const status = el('p', {
      role: 'alert',
      'aria-label': 'Sign-in status',
      'aria-live': 'assertive',
    });
    if (next) {
      status.append(SESSION_ENDED);
    }
    const email = el('input', { type: 'email', id: 'sign-in-email', autocomplete: 'username' });
    const password = el('input', {
      type: 'password',
      id: 'sign-in-password',
      autocomplete: 'current-password',
    });
    const form = el('form', { on: { submit: submit } }, [
      el('label', { for: 'sign-in-email', text: 'Email' }),
      email,
      el('label', { for: 'sign-in-password', text: 'Password' }),
      password,
      el('p', {}, [el('button', { type: 'submit', text: 'Sign in' })]),
    ]);
    context.page.append(
      el('div', { class: 'signin' }, [
        el('span', { dataset: { figure: 'true' }, text: 'Wardline' }),
        el('span', { dataset: { figureLabel: 'true' }, text: 'Custody and disclosure' }),
        form,
        status,
      ])
    );
    email.focus();

    async function submit(event) {
      event.preventDefault();
      const body = { email: email.value, password: password.value };
      if (next) body.next = next;
      const reply = await post('/api/sign-in', body);
      if (reply.status === 200) {
        await loadSession();
        go(reply.body.landing);
        return;
      }
      status.classList.add('refusal');
      status.textContent = reply.status === 429 ? LOCKED : FAILED;
    }

    return {};
  },
};
