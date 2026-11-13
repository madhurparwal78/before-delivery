import { COPY } from '../../shared/copy';
import { call } from '../lib/api';
import { el } from '../lib/dom';
import { requestRender, state } from '../store';
import { takeSignedOutFlag } from '../session';

let signedOutNotice = false;

export function readSignedOutNotice(): void {
  signedOutNotice = takeSignedOutFlag();
}

async function submit(): Promise<void> {
  state.signIn.pending = true;
  state.signIn.error = null;
  requestRender();
  try {
    const reply = await call<{ redirectTo: string }>('/api/session', {
      method: 'POST',
      body: {
        email: state.signIn.email,
        password: state.signIn.password,
        ...(state.signIn.next === null ? {} : { next: state.signIn.next }),
      },
      allowSignedOut: true,
    });
    window.location.replace(reply.redirectTo);
  } catch {
    state.signIn.pending = false;
    state.signIn.error = COPY.badCredentials;
    requestRender();
  }
}

export function renderSignIn(): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const main = el('main', { class: 'signin' });
  main.append(el('h1', { text: 'Sign in to Kinfold' }));
  if (signedOutNotice) {
    main.append(
      el('div', { class: 'signin-status', attrs: { role: 'status' } }, [el('p', { text: COPY.signedOut })]),
    );
  }
  const form = el('form', {
    class: 'signin-form',
    on: {
      submit: (event: SubmitEvent) => {
        event.preventDefault();
        void submit();
      },
    },
  });
  const email = el('input', {
    class: 'field',
    focusKey: 'signin:email',
    attrs: { type: 'email', 'aria-label': 'Email', autocomplete: 'username', name: 'email' },
    on: {
      input: (event: Event) => {
        state.signIn.email = (event.target as HTMLInputElement).value;
      },
    },
  });
  email.value = state.signIn.email;
  const password = el('input', {
    class: 'field',
    focusKey: 'signin:password',
    attrs: {
      type: 'password',
      role: 'textbox',
      'aria-label': 'Password',
      autocomplete: 'current-password',
      name: 'password',
    },
    on: {
      input: (event: Event) => {
        state.signIn.password = (event.target as HTMLInputElement).value;
      },
    },
  });
  password.value = state.signIn.password;
  form.append(el('label', {}, [document.createTextNode('Email'), email]));
  form.append(el('label', {}, [document.createTextNode('Password'), password]));
  form.append(
    el('button', {
      class: 'primary',
      text: state.signIn.pending ? 'Signing in…' : 'Sign in',
      focusKey: 'signin:submit',
      attrs: { type: 'submit' },
    }),
  );
  if (state.signIn.error !== null) {
    form.append(el('p', { class: 'field-error', text: state.signIn.error, attrs: { role: 'alert' } }));
  }
  main.append(form);
  fragment.append(main);
  return fragment;
}
