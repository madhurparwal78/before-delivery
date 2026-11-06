import type { SessionUser } from '../shared/api-types';
import { el, request, runAction } from './core';
import { FormField } from './forms';

const NO_MATCH = "That email and password don't match a Bloom Desk account.";

export function renderSignIn(root: HTMLElement): void {
  const email = new FormField({
    name: 'email',
    label: 'Email',
    kind: 'text',
    autocomplete: 'username',
    inputmode: 'email',
  });
  const password = new FormField({
    name: 'password',
    label: 'Password',
    kind: 'text',
    password: true,
    autocomplete: 'current-password',
  });
  const submit = el('button', {
    type: 'submit',
    class: 'button button--primary',
    text: 'Sign in',
  });

  const form = el('form', { class: 'signin__form', novalidate: true }, [
    email.wrapper,
    password.wrapper,
    submit,
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void runAction({
      button: submit,
      pending: 'Signing in…',
      run: () =>
        request<{ user: SessionUser }>('POST', '/api/session', {
          body: { email: email.value, password: password.control.value },
        }),
      success: () => '',
      refusal: (failure) => (failure.status === 401 ? NO_MATCH : null),
    }).then((result) => {
      if (result !== null) window.location.assign('/desk');
    });
  });

  root.append(
    el('main', { class: 'signin' }, [
      el('div', { class: 'signin__card' }, [
        el('h1', { class: 'wordmark', text: 'Swarmline Bloom Desk' }),
        el('p', {
          class: 'signin__lede',
          text: 'The season desk for almond pollination brokers.',
        }),
        form,
      ]),
    ]),
  );
}
