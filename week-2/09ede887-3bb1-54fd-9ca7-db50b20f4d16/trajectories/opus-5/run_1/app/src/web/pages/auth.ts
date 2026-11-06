import { ApiFailure, api } from '../api.js';
import { sayAccount } from '../chrome.js';
import { FIELD_COPY, PENDING_COPY, refusalCopy } from '../copy.js';
import { el } from '../dom.js';
import { navigate, type Page } from '../router.js';
import { adopt } from '../session.js';
import { errorSummary, markField, type FieldError } from '../components/form.js';

/** Accepted only when it starts with exactly one `/` and the next character is neither `/` nor `\`. */
function safeNext(next: string | null): string {
  if (next === null || !next.startsWith('/')) return '/agenda';
  const second = next[1];
  return second === '/' || second === '\\' ? '/agenda' : next;
}

function field(id: string, label: string, type: string): {
  readonly wrapper: HTMLElement;
  readonly input: HTMLInputElement;
  readonly error: HTMLElement;
} {
  const input = el('input', { class: 'text-input', id, type, autocomplete: type === 'password' ? 'current-password' : 'on' });
  const error = el('p', { class: 'field-error', id: `${id}-error` });
  const wrapper = el('div', { class: 'field' }, [el('label', { for: id, text: label }), input, error]);
  return { wrapper, input, error };
}

export function authPage(mode: 'signin' | 'signup'): Page {
  const element = el('main', { class: 'page page-auth', id: 'main' });
  const next = safeNext(new URLSearchParams(location.search).get('next'));
  const carried = next === '/agenda' ? '' : `?next=${encodeURIComponent(next)}`;
  const summary = errorSummary();
  const name = field('signup-name', 'Name', 'text');
  const email = field('auth-email', 'Email', 'email');
  const password = field('auth-password', 'Password', 'password');
  if (mode === 'signup') password.input.setAttribute('autocomplete', 'new-password');

  const form = el('form', { class: 'stack-form', novalidate: true }, [summary.element]);
  if (mode === 'signup') form.appendChild(name.wrapper);
  form.append(
    email.wrapper,
    password.wrapper,
    el('button', {
      class: 'button button-primary',
      type: 'submit',
      text: mode === 'signin' ? 'Sign in' : 'Create account',
    }),
    mode === 'signin'
      ? el('p', {}, [el('a', { href: `/signup${carried}`, text: 'Create an account' })])
      : el('p', {}, [el('a', { href: `/signin${carried}`, text: 'Sign in instead' })]),
  );

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const errors: FieldError[] = [];
    markField(email.input, email.error, null);
    markField(password.input, password.error, null);
    if (mode === 'signup') markField(name.input, name.error, null);
    if (mode === 'signup' && (name.input.value.trim() === '' || [...name.input.value].length > 80)) {
      markField(name.input, name.error, FIELD_COPY.name);
      errors.push({ id: name.input.id, message: FIELD_COPY.name });
    }
    if (!isEmail(email.input.value.trim())) {
      markField(email.input, email.error, FIELD_COPY.email);
      errors.push({ id: email.input.id, message: FIELD_COPY.email });
    }
    if (mode === 'signup' ? password.input.value.length < 8 : password.input.value === '') {
      const message = mode === 'signup' ? FIELD_COPY.signupPassword : FIELD_COPY.signinPassword;
      markField(password.input, password.error, message);
      errors.push({ id: password.input.id, message });
    }
    if (errors.length > 0) {
      summary.show(errors);
      return;
    }
    summary.hide();
    void submit();
  });

  async function submit(): Promise<void> {
    sayAccount(mode === 'signin' ? PENDING_COPY.signin : PENDING_COPY.signup);
    try {
      const answer =
        mode === 'signin'
          ? await api.login(email.input.value.trim(), password.input.value)
          : await api.signup(name.input.value, email.input.value.trim(), password.input.value);
      adopt(answer.token, answer.account);
      sayAccount(`${mode === 'signin' ? 'Welcome back' : 'Welcome'}, ${answer.account.name}.`);
      navigate(next);
    } catch (error) {
      const failure = error instanceof ApiFailure ? error : new ApiFailure('outage', 0);
      if (failure.code === 'email_taken') {
        markField(email.input, email.error, refusalCopy('email_taken'));
        summary.show([{ id: email.input.id, message: refusalCopy('email_taken') }]);
        sayAccount(null);
        return;
      }
      if (failure.code === 'invalid') {
        const errors: FieldError[] = [];
        for (const [key, message] of Object.entries(failure.fields)) {
          const target = key === 'name' ? name : key === 'email' ? email : password;
          markField(target.input, target.error, message);
          errors.push({ id: target.input.id, message });
        }
        if (errors.length > 0) summary.show(errors);
        sayAccount(null);
        return;
      }
      // invalid_credentials and rate_limited: form-level copy only.
      summary.hide();
      sayAccount(refusalCopy(failure.code));
    }
  }

  element.append(
    el('h1', { text: mode === 'signin' ? 'Sign in' : 'Create an account' }),
    el('p', {
      class: 'helper-line',
      text:
        mode === 'signin'
          ? 'Sign in to save sessions and reserve seats.'
          : 'An account lets you save sessions and reserve seats.',
    }),
    form,
  );
  return { element };
}

function isEmail(value: string): boolean {
  const at = value.indexOf('@');
  if (at <= 0 || at !== value.lastIndexOf('@')) return false;
  return value.slice(at + 1).includes('.') && !/\s/.test(value);
}
