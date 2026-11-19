import { api } from '../api';
import { h, showAlert } from '../dom';
import { loadMe } from '../state';
import { S } from '../strings';

const PENDING_EMAIL = 'pw_pending_email';

export function landingView(): HTMLElement {
  return h('div', { class: 'landing' }, [
    h('header', { class: 'landing-head' }, [
      h('a', { href: '/', 'aria-label': 'Plainwork', class: 'monogram' }, ['Pw']),
      h('nav', { class: 'landing-nav' }, [
        h('a', { href: '/signin', class: 'link' }, ['Sign in']),
        h('a', { href: '/join', class: 'link underline' }, ['Join']),
      ]),
    ]),
    h('h1', { class: 'landing-name', 'aria-label': 'Plainwork' }, [
      h('span', { class: 'line one', text: 'Plain-' }),
      h('span', { class: 'line two', text: 'work' }),
    ]),
    h('p', { class: 'promise', text: 'Every rule, stated.' }),
    h('section', { class: 'statements' }, [
      h('p', { class: 'statement pos-a', text: 'Your degree, in big type.' }),
      h('p', { class: 'statement pos-b', text: 'Every job shows its stages.' }),
      h('p', { class: 'statement pos-c', text: 'Block means gone.' }),
    ]),
  ]);
}

function authHead(): HTMLElement {
  return h('header', { class: 'landing-head' }, [
    h('a', { href: '/', 'aria-label': 'Plainwork', class: 'monogram' }, ['Pw']),
  ]);
}

function field(label: string, type: string): { wrap: HTMLElement; input: HTMLInputElement } {
  const input = h('input', { type, 'aria-label': label, class: 'input' }) as HTMLInputElement;
  return {
    wrap: h('label', { class: 'field' }, [h('span', { text: label }), input]),
    input,
  };
}

export function joinView(navigate: (path: string) => void): HTMLElement {
  const name = field('Name', 'text');
  const email = field('Email', 'email');
  const handle = field('Handle', 'text');
  const password = field('Password', 'password');
  const form = h('form', { class: 'form' });
  const submit = h('button', { type: 'submit', class: 'button' }, ['Create account']);
  form.append(
    h('h1', { class: 'page-title', text: 'Join Plainwork' }),
    name.wrap,
    email.wrap,
    handle.wrap,
    password.wrap,
    submit,
  );
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.setAttribute('disabled', '');
    const result = await api.post<{ fields?: Record<string, string> }>('/api/auth/signup', {
      name: name.input.value,
      email: email.input.value,
      handle: handle.input.value,
      password: password.input.value,
    });
    submit.removeAttribute('disabled');
    if (result.ok) {
      window.sessionStorage.setItem(PENDING_EMAIL, email.input.value);
      navigate('/confirm');
      return;
    }
    const fields = result.body.fields ?? {};
    const message = Object.values(fields)[0] ?? S.alert.somethingWrong;
    showAlert(form, message);
  });
  return h('div', { class: 'narrow' }, [authHead(), form]);
}

export function confirmView(navigate: (path: string) => void): HTMLElement {
  const code = field('Confirmation code', 'text');
  const form = h('form', { class: 'form' });
  const submit = h('button', { type: 'submit', class: 'button' }, ['Confirm']);
  form.append(
    h('h1', { class: 'page-title', text: 'Confirm your email' }),
    h('p', { class: 'muted', text: 'We sent you a six-digit code.' }),
    code.wrap,
    submit,
  );
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.setAttribute('disabled', '');
    const result = await api.post<{ fields?: Record<string, string> }>('/api/auth/confirm', {
      email: window.sessionStorage.getItem(PENDING_EMAIL) ?? '',
      code: code.input.value,
    });
    submit.removeAttribute('disabled');
    if (result.ok) {
      window.sessionStorage.removeItem(PENDING_EMAIL);
      await loadMe();
      navigate('/feed');
      return;
    }
    showAlert(form, result.body.fields?.code ?? S.alert.somethingWrong);
  });
  return h('div', { class: 'narrow' }, [authHead(), form]);
}

export function signInView(navigate: (path: string) => void): HTMLElement {
  const email = field('Email', 'email');
  const password = field('Password', 'password');
  const form = h('form', { class: 'form' });
  const submit = h('button', { type: 'submit', class: 'button' }, ['Sign in']);
  form.append(
    h('h1', { class: 'page-title', text: 'Sign in' }),
    email.wrap,
    password.wrap,
    submit,
  );
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.setAttribute('disabled', '');
    const result = await api.post<{ error?: string }>('/api/auth/signin', {
      email: email.input.value,
      password: password.input.value,
    });
    submit.removeAttribute('disabled');
    if (result.ok) {
      await loadMe();
      navigate('/feed');
      return;
    }
    if (result.body.error === 'unconfirmed') {
      window.sessionStorage.setItem(PENDING_EMAIL, email.input.value);
      showAlert(form, S.alert.unconfirmedSignIn);
      return;
    }
    showAlert(form, S.alert.wrongSignIn);
  });
  return h('div', { class: 'narrow' }, [authHead(), form]);
}
