import type { App } from '../app';
import { el } from '../dom';
import { formField } from './form';

export function renderAuth(app: App, kind: 'sign-in' | 'sign-up'): HTMLElement {
  const signUp = kind === 'sign-up';
  const submit = (): void => {
    if (signUp) void app.submitSignUp();
    else void app.submitSignIn();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  };

  const fields = signUp
    ? [
        formField(app, { name: 'display_name', label: 'Your name', onKeyDown }),
        formField(app, { name: 'email', label: 'Email', kind: 'email', onKeyDown }),
        formField(app, { name: 'password', label: 'Password', kind: 'password', onKeyDown }),
      ]
    : [
        formField(app, { name: 'email', label: 'Email', kind: 'email', onKeyDown }),
        formField(app, { name: 'password', label: 'Password', kind: 'password', onKeyDown }),
      ];

  return el(
    'main',
    { class: 'auth-screen' },
    el('p', { class: 'wordmark', style: 'margin-bottom:1.5rem' }, 'Duefield'),
    el('h1', {}, signUp ? 'Create your practice' : 'Sign in'),
    el('p', { class: 'hint', style: 'margin-bottom:1.5rem' }, "Every return, due in its own state's time."),
    el('div', { class: 'stack', style: 'align-items:stretch' }, ...fields),
    el(
      'button',
      {
        type: 'button',
        class: 'primary',
        'data-focus-key': 'auth-submit',
        onClick: submit,
      },
      app.isBusy('auth') ? 'Saving' : signUp ? 'Create practice' : 'Sign in',
    ),
    el(
      'p',
      { style: 'margin-top:1.25rem' },
      signUp
        ? el('a', { href: '/sign-in', 'data-link': 'true' }, 'Sign in')
        : el('a', { href: '/sign-up', 'data-link': 'true' }, 'Create a practice'),
    ),
  );
}
