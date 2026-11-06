// Sign in and sign up, landing on the safe `next` route afterwards.
import * as api from '../api.js';
import { COPY } from '../boot.js';
import { el, field, setFieldError } from '../dom.js';
import { discardDraftForOther } from '../drafts.js';
import { activity, refreshAccount } from '../main.js';

export function safeNext(raw) {
  if (raw === null || raw === undefined) return null;
  let once;
  try {
    once = decodeURIComponent(raw);
  } catch {
    return null;
  }
  let twice;
  try {
    twice = decodeURIComponent(once);
  } catch {
    twice = once;
  }
  for (const candidate of [once, twice]) {
    if (!candidate.startsWith('/')) return null;
    if (candidate.startsWith('//') || candidate.startsWith('/\\')) return null;
    for (const character of candidate) {
      const code = character.codePointAt(0);
      if (code <= 31 || code === 127) return null;
    }
  }
  return once;
}

export async function render(context) {
  const signingUp = context.path === '/signup';
  const rawNext = context.query.get('next');
  const next = safeNext(rawNext);

  const emailField = field('Email', el('input', { type: 'email', name: 'email', required: true }));
  const passwordField = field(
    'Password',
    el('input', { type: 'password', name: 'password', required: true }),
  );
  const submit = el('button', {
    type: 'submit',
    class: 'solid',
    text: signingUp ? 'Create account' : 'Sign in',
  });
  const otherHref = (signingUp ? '/signin' : '/signup')
    + (rawNext ? `?next=${rawNext}` : '');

  const form = el('form', { class: 'single-column', novalidate: true }, [
    el('h1', { text: signingUp ? 'Create account' : 'Sign in' }),
    emailField.wrapper,
    passwordField.wrapper,
    submit,
    el('a', {
      href: otherHref,
      text: signingUp ? 'Sign in instead' : 'Create an account instead',
    }),
  ]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setFieldError(emailField, '');
    setFieldError(passwordField, '');
    activity(signingUp ? COPY.pending.signup : COPY.pending.signin);
    try {
      const body = {
        email: emailField.control.value,
        password: passwordField.control.value,
      };
      await api.post(signingUp ? '/api/auth/signup' : '/api/auth/signin', body);
      const account = await refreshAccount();
      discardDraftForOther(account ? account.id : null);
      await api.storageState();
      activity('');
      await context.navigate(next || '/archive', { replace: true });
    } catch (failure) {
      if (failure.status === 422) {
        if (failure.fields.email) setFieldError(emailField, failure.fields.email);
        if (failure.fields.password) setFieldError(passwordField, failure.fields.password);
        const first = failure.fields.email ? emailField : passwordField;
        activity(failure.fields.email || failure.fields.password);
        first.control.focus();
        return;
      }
      activity(COPY.error[failure.code] || COPY.error.invalid_credentials);
    }
  });

  return el('section', { class: 'auth' }, [form]);
}
