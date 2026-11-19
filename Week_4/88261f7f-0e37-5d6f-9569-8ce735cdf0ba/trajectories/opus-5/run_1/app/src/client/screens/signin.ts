import { pendingTexts } from '../../shared/notices';
import { call } from '../api';
import { homeFor } from '../app';
import { button, el, labelled, textbox } from '../dom';
import { regionNames, setMessage, statusRegion } from '../regions';
import { User } from '../types';

export function signInScreen(): HTMLElement {
  const email = textbox('Email', '', 'email');
  const password = textbox('Password', '', 'password');
  const submit = button('Sign in', () => void send());

  async function send(): Promise<void> {
    if (submit.getAttribute('aria-busy') === 'true') return;
    submit.setAttribute('aria-busy', 'true');
    setMessage(regionNames.signIn, pendingTexts.signIn);
    const result = await call<{ user: User }>('/api/session', {
      method: 'POST',
      body: { email: email.value, password: password.value },
    });
    submit.removeAttribute('aria-busy');
    if (result.data) {
      window.location.assign(homeFor(result.data.user.role));
      return;
    }
    setMessage(regionNames.signIn, result.error ?? 'That email or password is not right.');
  }

  const form = el('form', { class: 'signin' }, [
    el('h1', { text: 'Nightroll' }),
    labelled('Email', email),
    labelled('Password', password),
    submit,
    statusRegion(regionNames.signIn),
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void send();
  });
  return el('div', { class: 'signin-page' }, [form]);
}
