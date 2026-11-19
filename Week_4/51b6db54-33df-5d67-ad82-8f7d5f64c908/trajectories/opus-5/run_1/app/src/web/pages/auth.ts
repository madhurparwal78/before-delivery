import { api, refusalText, type ApiFailure } from '../api.js';
import { button, el, field, fieldError, textbox } from '../dom.js';
import { mountRegions } from '../regions.js';
import { loadMe } from '../session.js';
import { go } from '../router.js';

export function signUpPage(): HTMLElement {
  const regions = mountRegions();
  const name = textbox('Name');
  const email = textbox('Email', { type: 'email' });
  const password = textbox('Password', { type: 'password' });
  const nameField = field('Name', name);
  const emailField = field('Email', email);
  const passwordField = field('Password', password);
  const code = textbox('Code', { inputmode: 'numeric', autocomplete: 'one-time-code' });
  const codeField = field('Code', code);
  const codeBlock = el('div', { class: 'code-block' }, [codeField]);
  codeBlock.hidden = true;

  const confirm = button('Confirm', async () => {
    const result = await api.post<ApiFailure>('/api/auth/confirm', {
      email: email.value.trim(),
      code: code.value.trim(),
    });
    if (!result.ok) {
      fieldError(codeField, result.body.errors?.code ?? refusalText(result));
      regions.alert(refusalText(result));
      return;
    }
    await loadMe();
    go('/projects');
  });
  codeBlock.append(confirm);

  const create = button('Create account', async () => {
    for (const wrap of [nameField, emailField, passwordField]) fieldError(wrap, null);
    regions.alert(null);
    const result = await api.post<ApiFailure>('/api/auth/signup', {
      name: name.value.trim(),
      email: email.value.trim(),
      password: password.value,
    });
    if (!result.ok) {
      const errors = result.body.errors ?? {};
      if (errors.name !== undefined) fieldError(nameField, errors.name);
      if (errors.email !== undefined) fieldError(emailField, errors.email);
      if (errors.password !== undefined) fieldError(passwordField, errors.password);
      regions.alert(refusalText(result));
      return;
    }
    regions.notice(`We are sending your code to ${email.value.trim()}`);
    codeBlock.hidden = false;
    code.focus();
  });

  return el('main', { class: 'column' }, [
    regions.root,
    el('div', { class: 'card' }, [
      el('h1', { text: 'Make an account' }),
      nameField,
      emailField,
      passwordField,
      create,
      codeBlock,
      el('p', { class: 'hint' }, [el('a', { href: '/signin' }, ['I already have an account'])]),
    ]),
  ]);
}

export function signInPage(): HTMLElement {
  const regions = mountRegions();
  const email = textbox('Email', { type: 'email' });
  const password = textbox('Password', { type: 'password' });
  const emailField = field('Email', email);
  const passwordField = field('Password', password);

  const submit = button('Sign in', async () => {
    fieldError(emailField, null);
    fieldError(passwordField, null);
    regions.alert(null);
    const result = await api.post<ApiFailure>('/api/auth/login', {
      email: email.value.trim(),
      password: password.value,
    });
    if (!result.ok) {
      const errors = result.body.errors ?? {};
      if (errors.email !== undefined) fieldError(emailField, errors.email);
      if (errors.password !== undefined) fieldError(passwordField, errors.password);
      regions.alert(refusalText(result));
      return;
    }
    await loadMe();
    const next = new URL(window.location.href).searchParams.get('next');
    go(next === null || next === '' ? '/projects' : next);
  });

  return el('main', { class: 'column' }, [
    regions.root,
    el('div', { class: 'card' }, [
      el('h1', { text: 'Sign in' }),
      emailField,
      passwordField,
      submit,
      el('p', { class: 'hint' }, [el('a', { href: '/signup' }, ['Make an account'])]),
    ]),
  ]);
}
