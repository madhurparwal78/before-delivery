import { announce } from '../core/announce';
import { failureOf, post } from '../core/api';
import { el, on } from '../core/dom';
import { navigate, type Cleanup, type PageContext } from '../core/router';
import { clearFieldErrors, fieldError, pageAlert, setCurrentUser, working, type Me } from '../core/shell';
import { narrowForm } from '../widgets/layout';

interface SignInBody {
  user: { id: string; display_name: string; role: Me['role']; unlocked: boolean };
}

function labelled(labelText: string, input: HTMLElement): HTMLElement {
  const id = `field-${labelText.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  input.id = id;
  return el('div', { class: 'field' }, [el('label', { for: id, text: labelText }), input]);
}

function textbox(type = 'text'): HTMLInputElement {
  return el('input', { type, class: 'textbox', autocomplete: 'off' });
}

function applyFailure(
  form: HTMLElement,
  inputs: Record<string, HTMLElement>,
  error: unknown,
  alert: (m: string | null) => void,
): void {
  const failure = failureOf(error);
  if (!failure) throw error;
  clearFieldErrors(form);
  if (failure.fields) {
    for (const [field, message] of Object.entries(failure.fields)) {
      const input = inputs[field];
      if (input) fieldError(input, message);
    }
    if (Object.keys(failure.fields).length > 0) return;
  }
  alert(failure.message);
}

async function refreshUser(): Promise<void> {
  const { get } = await import('../core/api');
  try {
    setCurrentUser(await get<Me>('/api/me'));
  } catch {
    setCurrentUser(null);
  }
}

export async function renderSignIn(container: HTMLElement): Promise<Cleanup> {
  const email = textbox('email');
  const password = textbox('password');
  const submit = el('button', { type: 'submit', class: 'solid-button', text: 'Sign in' });
  const form = el('form', { class: 'stack' }, [
    labelled('Email', email),
    labelled('Password', password),
    submit,
    el('a', { href: '/forgot-password', text: 'Forgot password?' }),
  ]);
  const page = narrowForm('Sign in', [form]);
  container.append(page);
  const alert = pageAlert(page);

  on(form, 'submit', (event) => {
    event.preventDefault();
    const done = working(submit);
    void post<SignInBody>('/api/auth/sign-in', { email: email.value, password: password.value })
      .then(async () => {
        await refreshUser();
        navigate('/');
      })
      .catch((error: unknown) => applyFailure(form, { email, password }, error, alert))
      .finally(done);
  });
  return () => undefined;
}

export async function renderJoin(container: HTMLElement): Promise<Cleanup> {
  const displayName = textbox();
  const email = textbox('email');
  const password = textbox('password');
  const submit = el('button', { type: 'submit', class: 'solid-button', text: 'Create account' });
  const form = el('form', { class: 'stack' }, [
    labelled('Display name', displayName),
    labelled('Email', email),
    labelled('Password', password),
    submit,
  ]);
  const page = narrowForm('Join Candour Bench', [form]);
  container.append(page);
  const alert = pageAlert(page);
  const note = el('p', { class: 'muted' });
  page.append(note);

  on(form, 'submit', (event) => {
    event.preventDefault();
    const done = working(submit);
    void post('/api/auth/join', {
      display_name: displayName.value,
      email: email.value,
      password: password.value,
    })
      .then(() => {
        note.textContent = 'Check your email to finish joining.';
        announce('Check your email to finish joining.');
      })
      .catch((error: unknown) => applyFailure(form, { display_name: displayName, email, password }, error, alert))
      .finally(done);
  });
  return () => undefined;
}

export async function renderJoinConfirm(container: HTMLElement, ctx: PageContext): Promise<Cleanup> {
  const page = narrowForm('Welcome to Candour Bench', []);
  container.append(page);
  const alert = pageAlert(page);
  try {
    await post('/api/auth/join/confirm', { token: ctx.query.get('token') ?? '' });
    await refreshUser();
    page.append(el('p', { text: 'Your account is ready. Share one post to unlock full pay detail.' }));
    page.append(el('a', { href: '/contribute', text: 'Share something' }));
  } catch (error) {
    const failure = failureOf(error);
    alert(failure?.message ?? 'This link has expired or was already used.');
  }
  return () => undefined;
}

export async function renderForgotPassword(container: HTMLElement): Promise<Cleanup> {
  const email = textbox('email');
  const submit = el('button', { type: 'submit', class: 'solid-button', text: 'Send reset link' });
  const form = el('form', { class: 'stack' }, [labelled('Email', email), submit]);
  const page = narrowForm('Forgot password', [form]);
  container.append(page);
  const alert = pageAlert(page);
  const note = el('p', { class: 'muted' });
  page.append(note);

  on(form, 'submit', (event) => {
    event.preventDefault();
    const done = working(submit);
    void post('/api/auth/forgot', { email: email.value })
      .then(() => {
        note.textContent = 'If that address has an account, a reset link is on its way.';
        announce('If that address has an account, a reset link is on its way.');
      })
      .catch((error: unknown) => applyFailure(form, { email }, error, alert))
      .finally(done);
  });
  return () => undefined;
}

export async function renderResetPassword(container: HTMLElement, ctx: PageContext): Promise<Cleanup> {
  const password = textbox('password');
  const submit = el('button', { type: 'submit', class: 'solid-button', text: 'Change password' });
  const form = el('form', { class: 'stack' }, [labelled('New password', password), submit]);
  const page = narrowForm('Choose a new password', [form]);
  container.append(page);
  const alert = pageAlert(page);

  on(form, 'submit', (event) => {
    event.preventDefault();
    const done = working(submit);
    void post('/api/auth/reset', { token: ctx.query.get('token') ?? '', password: password.value })
      .then(async () => {
        await refreshUser();
        navigate('/');
        announce('Password changed. You are signed in.');
      })
      .catch((error: unknown) => applyFailure(form, { password }, error, alert))
      .finally(done);
  });
  return () => undefined;
}
