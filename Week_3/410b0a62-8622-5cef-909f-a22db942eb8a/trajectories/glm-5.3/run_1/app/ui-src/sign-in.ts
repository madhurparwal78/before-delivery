import { api } from './api.js';
import { h } from './dom.js';

export function renderSignIn(): HTMLElement {
  const alertBox = h('div', { class: 'alert hidden', role: 'alert' });
  const email = h('input', {
    class: 'field',
    type: 'email',
    id: 'sign-in-email',
    autocomplete: 'username',
  }) as HTMLInputElement;
  const emailLabel = h('label', { for: 'sign-in-email' }, 'Email');
  const password = h('input', {
    class: 'field',
    type: 'password',
    id: 'sign-in-password',
    autocomplete: 'current-password',
  }) as HTMLInputElement;
  const passwordLabel = h('label', { for: 'sign-in-password' }, 'Password');
  const submit = h('button', { class: 'pill pill-primary', type: 'submit' }, 'Sign in');

  const form = h(
    'form',
    {
      class: 'sign-in-form',
      onsubmit: async (event: Event) => {
        event.preventDefault();
        const first = (event.currentTarget as HTMLFormElement).querySelector<HTMLElement>('input, button');
        void first;
        alertBox.classList.add('hidden');
        submit.disabled = true;
        submit.textContent = 'Signing in…';
        try {
          await api.post('/auth/sign-in', {
            email: email.value,
            password: password.value,
          });
          window.location.href = '/';
        } catch (err) {
          submit.disabled = false;
          submit.textContent = 'Sign in';
          alertBox.textContent = (err as Error).message;
          alertBox.classList.remove('hidden');
          alertBox.focus();
        }
      },
    },
    emailLabel,
    email,
    passwordLabel,
    password,
    alertBox,
    submit
  );

  const card = h('section', { class: 'card sign-in-card' }, h('h1', {}, 'Sign in to Tempoline'), form);
  email.setAttribute('aria-label', 'Email');
  password.setAttribute('aria-label', 'Password');
  return h('div', { class: 'page sign-in-page' }, card);
}
