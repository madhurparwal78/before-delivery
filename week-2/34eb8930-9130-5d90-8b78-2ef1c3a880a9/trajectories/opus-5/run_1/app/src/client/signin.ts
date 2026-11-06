import { ApiError, api } from './api.js';
import { el } from './dom.js';
import { hideBanner, navigate, renderInto, showBanner } from './shell.js';

export function renderSignIn(next: string): void {
  const emailError = el('p', { class: 'field-error', id: 'email-error' });
  const passwordError = el('p', { class: 'field-error', id: 'password-error' });
  const email = el('input', { type: 'email', id: 'signin-email', name: 'email', autocomplete: 'username' });
  const password = el('input', { type: 'password', id: 'signin-password', name: 'password', autocomplete: 'current-password' });
  const button = el('button', { type: 'submit', class: 'primary', text: 'Sign in' });

  const form = el(
    'form',
    {
      class: 'signin-card',
      onsubmit: (event: Event) => {
        event.preventDefault();
        void submit();
      },
    },
    [
      el('p', { class: 'brand', text: 'Quillmere Drafts' }),
      el('h1', { text: 'Sign in to Quillmere Drafts' }),
      el('div', { class: 'field' }, [el('label', { for: 'signin-email', text: 'Email' }), email, emailError]),
      el('div', { class: 'field' }, [el('label', { for: 'signin-password', text: 'Password' }), password, passwordError]),
      button,
    ],
  );

  async function submit(): Promise<void> {
    hideBanner('signin');
    emailError.textContent = '';
    passwordError.textContent = '';
    button.disabled = true;
    button.textContent = 'Signing in';
    try {
      await api.signIn(email.value, password.value);
      navigate(next || '/', { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        showBanner('signin', "That email and password don't match.");
      } else if (error instanceof ApiError && error.fields) {
        emailError.textContent = error.fields.email ?? '';
        passwordError.textContent = error.fields.password ?? '';
        (error.fields.email ? email : password).focus();
      }
      button.disabled = false;
      button.textContent = 'Sign in';
    }
  }

  renderInto(el('main', { class: 'signin-page' }, [form]));
  email.focus();
}
