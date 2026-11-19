import { api, ApiCallError } from '../api.js';
import { el, on } from '../dom.js';
import { labelledField } from '../forms.js';
import { announce, statusRegion } from '../status.js';

function applyFieldErrors(
  errors: Record<string, string> | undefined,
  fields: Record<string, { setError: (m: string | null) => void }>,
): void {
  for (const field of Object.values(fields)) field.setError(null);
  for (const [key, message] of Object.entries(errors ?? {})) {
    fields[key]?.setError(message);
  }
}

export function renderAccount(main: HTMLElement, search: URLSearchParams): void {
  main.className = 'page page--account';
  const status = statusRegion('Account status');

  const name = labelledField({ name: 'Name' });
  const email = labelledField({ name: 'Email', kind: 'email', value: search.get('email') ?? '' });
  const password = labelledField({ name: 'Password', kind: 'password' });
  const createAccount = el('button', { type: 'submit', class: 'pill pill--dark' }, 'Create account');
  const signUpForm = el('form', { class: 'stack card' }, [
    el('h2', { class: 'card__title' }, 'Create your account'),
    name.wrap,
    email.wrap,
    password.wrap,
    createAccount,
  ]) as HTMLFormElement;

  const code = labelledField({ name: 'Verification code' });
  const verify = el('button', { type: 'submit', class: 'pill pill--dark' }, 'Verify');
  const verifyForm = el('form', { class: 'stack card' }, [
    el('h2', { class: 'card__title' }, 'Verify your email'),
    code.wrap,
    verify,
  ]) as HTMLFormElement;

  const signInEmail = labelledField({ name: 'Sign-in email', kind: 'email' });
  const signInPassword = labelledField({ name: 'Sign-in password', kind: 'password' });
  const signIn = el('button', { type: 'submit', class: 'pill pill--dark' }, 'Sign in');
  const signInForm = el('form', { class: 'stack card' }, [
    el('h2', { class: 'card__title' }, 'Sign in'),
    signInEmail.wrap,
    signInPassword.wrap,
    signIn,
  ]) as HTMLFormElement;

  const teamCode = labelledField({ name: 'Team code' });
  const joinTeam = el('button', { type: 'submit', class: 'pill pill--dark' }, 'Join team');
  const joinForm = el('form', { class: 'stack card' }, [
    el('h2', { class: 'card__title' }, 'Join a team'),
    teamCode.wrap,
    joinTeam,
  ]) as HTMLFormElement;

  let pendingEmail = search.get('email') ?? '';

  on(signUpForm, 'submit', (event) => {
    event.preventDefault();
    if (createAccount.getAttribute('aria-busy') === 'true') return;
    createAccount.setAttribute('aria-busy', 'true');
    const address = (email.input as HTMLInputElement).value.trim();
    void api
      .post('/api/signup', {
        name: (name.input as HTMLInputElement).value,
        email: address,
        password: (password.input as HTMLInputElement).value,
      })
      .then(() => {
        applyFieldErrors({}, { name, email, password });
        pendingEmail = address;
        announce('Account status', `We sent a 6-digit code to ${address}`);
      })
      .catch((err) => {
        if (err instanceof ApiCallError) applyFieldErrors(err.failure.errors, { name, email, password });
      })
      .finally(() => createAccount.removeAttribute('aria-busy'));
  });

  on(verifyForm, 'submit', (event) => {
    event.preventDefault();
    if (verify.getAttribute('aria-busy') === 'true') return;
    verify.setAttribute('aria-busy', 'true');
    void api
      .post('/api/verify', {
        email: pendingEmail || (email.input as HTMLInputElement).value.trim(),
        code: (code.input as HTMLInputElement).value,
      })
      .then(() => {
        code.setError(null);
        announce('Account status', 'Email verified');
      })
      .catch((err) => {
        if (err instanceof ApiCallError) applyFieldErrors(err.failure.errors, { code });
      })
      .finally(() => verify.removeAttribute('aria-busy'));
  });

  on(signInForm, 'submit', (event) => {
    event.preventDefault();
    if (signIn.getAttribute('aria-busy') === 'true') return;
    signIn.setAttribute('aria-busy', 'true');
    void api
      .post('/api/signin', {
        email: (signInEmail.input as HTMLInputElement).value,
        password: (signInPassword.input as HTMLInputElement).value,
      })
      .then(() => {
        window.location.href = '/';
      })
      .catch(() => {
        announce('Account status', 'That email and password do not match an account');
        signIn.removeAttribute('aria-busy');
      });
  });

  on(joinForm, 'submit', (event) => {
    event.preventDefault();
    if (joinTeam.getAttribute('aria-busy') === 'true') return;
    joinTeam.setAttribute('aria-busy', 'true');
    void api
      .post<{ teamId: string; name: string }>('/api/teams/join', {
        code: (teamCode.input as HTMLInputElement).value,
      })
      .then((team) => {
        announce('Account status', `You joined ${team.name}`);
      })
      .catch((err) => {
        if (err instanceof ApiCallError && err.failure.error === 'not_verified') {
          announce('Account status', 'Verify your email before joining a team');
        } else if (err instanceof ApiCallError && err.failure.status === 404) {
          teamCode.setError('That team code is not right');
        } else if (err instanceof ApiCallError && err.failure.status === 401) {
          announce('Account status', 'Sign in before joining a team');
        }
      })
      .finally(() => joinTeam.removeAttribute('aria-busy'));
  });

  main.append(
    el('h1', { class: 'page__title' }, 'Your account'),
    status,
    signUpForm,
    verifyForm,
    signInForm,
    joinForm,
  );
}
