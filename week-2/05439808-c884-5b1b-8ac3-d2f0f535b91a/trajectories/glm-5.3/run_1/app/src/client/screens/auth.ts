// The public screens: sign up, sign in, forgot and reset password, and email confirmation.
// Each shows its published pending, success, error and field-error copy in the live regions.
import { el, notice, alertMessage, clearFieldErrors, showFieldErrors, FieldErrors } from '../ui.ts';
import { api, ApiRequestError } from '../api.ts';
import { navigate } from '../main.ts';
import { state } from '../state.ts';

function field(labelText: string, input: HTMLInputElement | HTMLSelectElement, name: string): HTMLElement {
  input.setAttribute('data-field', name);
  input.id = input.id || name;
  return el('div', { class: 'field' }, el('label', { for: input.id, text: labelText }), input);
}

function textBox(name: string, id: string, type = 'text'): HTMLInputElement {
  const input = el('input', { id, type, name, autocomplete: 'off' });
  input.setAttribute('data-field', name);
  return input;
}

function submitButton(label: string): HTMLButtonElement {
  return el('button', { class: 'primary', type: 'submit', text: label });
}

function setBusy(button: HTMLButtonElement, busy: boolean, pendingCopy: string | null): void {
  button.classList.toggle('busy', busy);
  if (busy && pendingCopy) notice(pendingCopy);
}

function handleError(container: HTMLElement, err: unknown): void {
  if (err instanceof ApiRequestError) {
    if (err.api.code === 'validation_failed') {
      alertMessage('Check the highlighted fields.');
      if (err.api.errors) showFieldErrors(container, err.api.errors as FieldErrors);
      return;
    }
    const copy: Record<string, string> = {
      invalid_credentials: 'That email and password don’t match an account.',
      invalid_token: 'This link has expired or was already used. Request a new one from the sign-in screen.',
      rate_limited: `Too many tries. Try again in ${Math.ceil(Number((err as ApiRequestError & { retryAfter?: number }).retryAfter ?? 1))} s.`,
      database_unavailable: 'The tide records are out of reach. Nothing was changed — try again in a moment.',
    };
    alertMessage(copy[err.api.code] ?? err.api.message);
    return;
  }
  alertMessage('Lost contact with the server. Check your connection and try again.');
}

function authShell(heading: string, form: HTMLFormElement, links: HTMLElement[]): HTMLElement {
  return el('div', { class: 'auth-screen' },
    el('div', { class: 'auth-card' },
      el('h1', { text: heading }),
      form,
      el('div', { class: 'auth-links' }, ...links)
    )
  );
}

function zoneSelect(id: string): HTMLSelectElement {
  const select = el('select', { id, name: 'timeZone' });
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    zones = ['UTC'];
  }
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  for (const zone of zones) {
    const option = el('option', { value: zone, text: zone });
    if (zone === browserZone) option.selected = true;
    select.append(option);
  }
  select.setAttribute('data-field', 'timeZone');
  return select;
}

export async function renderSignUp(root: HTMLElement): Promise<void> {
  const email = textBox('email', 'signup-email');
  email.type = 'email';
  const password = textBox('password', 'signup-password');
  password.type = 'password';
  const displayName = textBox('displayName', 'signup-name');
  const timeZone = zoneSelect('signup-zone');
  const button = submitButton('Create island');

  const form = el('form', { onsubmit: async (event: Event) => {
    event.preventDefault();
    clearFieldErrors(form);
    setBusy(button, true, 'Creating your island…');
    try {
      await api('POST', '/api/auth/signup', {
        email: email.value,
        password: password.value,
        displayName: displayName.value,
        timeZone: timeZone.value,
      });
      notice(`Check your inbox at ${email.value}. Your confirmation link may take a few minutes to arrive.`);
    } catch (err) {
      handleError(form, err);
    } finally {
      setBusy(button, false, null);
    }
  }},
    field('Email', email, 'email'),
    field('Password', password, 'password'),
    field('Display name', displayName, 'displayName'),
    el('div', { class: 'field' }, el('label', { for: 'signup-zone', text: 'Time zone' }), timeZone),
    button
  );

  root.replaceChildren(authShell('Make your island', form, [
    el('a', { href: '/signin', text: 'Sign in instead', onclick: (event: MouseEvent) => { event.preventDefault(); void navigate('/signin'); } }),
  ]));
}

export async function renderSignIn(root: HTMLElement): Promise<void> {
  const email = textBox('email', 'signin-email');
  email.type = 'email';
  const password = textBox('password', 'signin-password');
  password.type = 'password';
  const button = submitButton('Sign in');
  const resend = el('button', { type: 'button', text: 'Send a new confirmation link' });

  resend.addEventListener('click', async () => {
    clearFieldErrors(form);
    if (email.value.length === 0) {
      alertMessage('Check the highlighted fields.');
      showFieldErrors(form, { email: 'This field is required.' });
      return;
    }
    setBusy(resend, true, 'Sending…');
    try {
      await api('POST', '/api/auth/resend-verification', { email: email.value });
      notice(`A fresh confirmation link is on its way to ${email.value}. It may take a few minutes.`);
    } catch (err) {
      handleError(form, err);
    } finally {
      setBusy(resend, false, null);
    }
  });

  const form = el('form', { onsubmit: async (event: Event) => {
    event.preventDefault();
    clearFieldErrors(form);
    setBusy(button, true, 'Signing in…');
    try {
      const result = await api<{ user: typeof state.me; csrfToken: string }>('POST', '/api/auth/signin', {
        email: email.value,
        password: password.value,
      });
      const { setCsrfToken } = await import('../api.ts');
      setCsrfToken(result.csrfToken);
      state.me = result.user;
      if (result.user?.role === 'operator') {
        await navigate('/ops', true);
      } else {
        await navigate('/', true);
      }
    } catch (err) {
      handleError(form, err);
    } finally {
      setBusy(button, false, null);
    }
  }},
    field('Email', email, 'email'),
    field('Password', password, 'password'),
    button,
    resend
  );

  root.replaceChildren(authShell('Back to the flats', form, [
    el('a', { href: '/forgot', text: 'Forgot password?', onclick: (event: MouseEvent) => { event.preventDefault(); void navigate('/forgot'); } }),
    el('a', { href: '/signup', text: 'Create an account', onclick: (event: MouseEvent) => { event.preventDefault(); void navigate('/signup'); } }),
  ]));
}

export async function renderForgot(root: HTMLElement): Promise<void> {
  const email = textBox('email', 'forgot-email');
  email.type = 'email';
  const button = submitButton('Send reset link');
  const form = el('form', { onsubmit: async (event: Event) => {
    event.preventDefault();
    clearFieldErrors(form);
    setBusy(button, true, 'Sending…');
    try {
      await api('POST', '/api/auth/forgot', { email: email.value });
      notice(`A reset link is on its way to ${email.value}. It works once and expires soon.`);
    } catch (err) {
      handleError(form, err);
    } finally {
      setBusy(button, false, null);
    }
  }},
    field('Email', email, 'email'),
    button
  );

  root.replaceChildren(authShell('Reset your password', form, [
    el('a', { href: '/signin', text: 'Back to sign in', onclick: (event: MouseEvent) => { event.preventDefault(); void navigate('/signin'); } }),
  ]));
}

export async function renderReset(root: HTMLElement): Promise<void> {
  const token = new URLSearchParams(location.search).get('token') ?? '';
  const password = textBox('password', 'reset-password');
  password.type = 'password';
  const button = submitButton('Set new password');
  const form = el('form', { onsubmit: async (event: Event) => {
    event.preventDefault();
    clearFieldErrors(form);
    setBusy(button, true, 'Saving…');
    try {
      await api('POST', '/api/auth/reset', { token, password: password.value });
      notice('Password changed. Sign in with your new password.');
      await navigate('/signin', true);
    } catch (err) {
      handleError(form, err);
    } finally {
      setBusy(button, false, null);
    }
  }},
    field('New password', password, 'password'),
    button
  );

  root.replaceChildren(authShell('Choose a new password', form, [
    el('a', { href: '/signin', text: 'Back to sign in', onclick: (event: MouseEvent) => { event.preventDefault(); void navigate('/signin'); } }),
  ]));
}

export async function renderVerify(root: HTMLElement): Promise<void> {
  const token = new URLSearchParams(location.search).get('token') ?? '';
  const signInLink = el('a', { href: '/signin', text: 'Go to sign in', onclick: (event: MouseEvent) => { event.preventDefault(); void navigate('/signin'); } });
  const card = el('div', { class: 'auth-card' },
    el('h1', { text: 'Confirming your email' }),
    el('p', { text: 'Confirming…', 'data-role': 'pending' }),
    signInLink
  );
  root.replaceChildren(el('div', { class: 'auth-screen' }, card));
  notice('Confirming…');
  try {
    await api('POST', '/api/auth/verify', { token });
    notice('Email confirmed. Your island is ready.');
    (card.querySelector('[data-role="pending"]') as HTMLElement).textContent = 'Email confirmed. Your island is ready.';
  } catch (err) {
    if (err instanceof ApiRequestError && err.api.code === 'invalid_token') {
      alertMessage('This link has expired or was already used. Request a new one from the sign-in screen.');
      (card.querySelector('[data-role="pending"]') as HTMLElement).textContent = 'This link has expired or was already used.';
    } else {
      handleError(card, err);
    }
  }
}
