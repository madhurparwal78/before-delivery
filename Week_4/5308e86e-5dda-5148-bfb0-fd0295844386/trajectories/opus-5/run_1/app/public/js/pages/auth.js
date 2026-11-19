import { el } from '../dom.js';
import * as api from '../api.js';
import * as session from '../session.js';
import * as router from '../router.js';
import { announce } from '../status.js';
import { marketingPage } from './layout.js';

const LOGIN_REFUSAL = 'Email or password is incorrect.';
const LOCKED_REFUSAL = 'Too many attempts. Try again later.';

function textField(id, label, type, autocomplete) {
  const input = el('input', { id, type, name: id, autocomplete });
  const error = el('span', { class: 'field-error', id: `${id}-error` });
  const wrapper = el('div', { class: 'field' }, [el('label', { for: id, text: label }), input, error]);
  return { wrapper, input, error };
}

function markError(field, message) {
  field.error.textContent = message;
  if (message) {
    field.input.setAttribute('aria-invalid', 'true');
    field.input.setAttribute('aria-describedby', field.error.id);
  } else {
    field.input.removeAttribute('aria-invalid');
    field.input.removeAttribute('aria-describedby');
  }
}

export const login = {
  title: 'Log in — Tallwind',
  render(context) {
    const email = textField('email', 'Email', 'email', 'email');
    const password = textField('password', 'Password', 'password', 'current-password');
    const submit = el('button', { class: 'pill', type: 'submit', text: 'Log in' });
    const form = el('form', { novalidate: true }, [
      email.wrapper,
      password.wrapper,
      el('div', { class: 'hero-actions' }, [submit]),
    ]);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (submit.disabled) return;
      markError(email, '');
      markError(password, '');
      submit.disabled = true;
      submit.textContent = 'Logging in…';
      announce('Logging in…');

      const answer = await api.post(
        '/api/auth/login',
        { email: email.input.value, password: password.input.value },
        { authenticated: false }
      );
      submit.disabled = false;
      submit.textContent = 'Log in';

      if (answer.status === 200) {
        session.setToken(answer.json.token);
        session.setUser(answer.json.user);
        const wanted = router.safeNext(context.query.get('next'));
        router.navigate(wanted || '/app', { replace: true });
        return;
      }
      if (answer.status === 429) {
        markError(password, LOCKED_REFUSAL);
        announce(LOCKED_REFUSAL);
        password.input.focus();
        return;
      }
      if (api.isOutage(answer)) {
        announce(api.OUTAGE_MESSAGE);
        return;
      }
      markError(password, LOGIN_REFUSAL);
      announce(LOGIN_REFUSAL);
      email.input.focus();
    });

    return marketingPage(
      [
        el('div', { class: 'wrap' }, [
          el('div', { class: 'auth-card' }, [
            el('h1', { text: 'Log in to Tallwind' }),
            el('p', { class: 'hint', text: 'Use the email your company signed up with.' }),
            form,
            el('p', {}, ['New here? ', el('a', { href: '/signup', text: 'Open an account' })]),
          ]),
        ]),
      ],
      { status: true }
    );
  },
};

export const signup = {
  title: 'Open an account — Tallwind',
  render() {
    const name = textField('name', 'Name', 'text', 'name');
    const email = textField('email', 'Email', 'email', 'email');
    const password = textField('password', 'Password', 'password', 'new-password');
    const submit = el('button', { class: 'pill', type: 'submit', text: 'Open account' });
    const form = el('form', { novalidate: true }, [
      name.wrapper,
      email.wrapper,
      password.wrapper,
      el('div', { class: 'hero-actions' }, [submit]),
    ]);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (submit.disabled) return;
      for (const field of [name, email, password]) markError(field, '');
      submit.disabled = true;
      submit.textContent = 'Opening account…';
      announce('Opening account…');

      const answer = await api.post(
        '/api/auth/signup',
        { name: name.input.value, email: email.input.value, password: password.input.value },
        { authenticated: false }
      );
      submit.disabled = false;
      submit.textContent = 'Open account';

      if (answer.status === 201) {
        session.setToken(answer.json.token);
        session.setUser(answer.json.user);
        router.navigate('/app', { replace: true });
        return;
      }
      if (answer.status === 409) {
        const message = 'An account with this email already exists';
        markError(email, message);
        announce(message);
        email.input.focus();
        return;
      }
      const fields = api.fieldErrors(answer);
      if (fields) {
        const map = { name, email, password };
        const copy = {
          name: 'Enter your name',
          email: 'Enter a valid email',
          password: 'Password must be at least 8 characters',
        };
        let first = null;
        for (const key of ['name', 'email', 'password']) {
          if (fields[key]) {
            markError(map[key], copy[key]);
            if (!first) first = map[key];
          }
        }
        announce(copy[Object.keys(fields)[0]] || 'Check the form');
        if (first) first.input.focus();
        return;
      }
      if (api.isOutage(answer)) announce(api.OUTAGE_MESSAGE);
      else announce(api.SERVER_ERROR_MESSAGE);
    });

    return marketingPage(
      [
        el('div', { class: 'wrap' }, [
          el('div', { class: 'auth-card' }, [
            el('h1', { text: 'Open your Tallwind account' }),
            el('p', { class: 'hint', text: 'One sitting, no branch visit, no paperwork in the post.' }),
            form,
            el('p', {}, ['Already with us? ', el('a', { href: '/login', text: 'Log in' })]),
          ]),
        ]),
      ],
      { status: true }
    );
  },
};
