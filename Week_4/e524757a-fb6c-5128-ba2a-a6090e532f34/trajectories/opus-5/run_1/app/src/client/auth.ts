import { copy } from '../shared/copy.js';
import { announce, api, bootstrap, byId, need } from './dom.js';

const FIELD_FOR_CODE: Record<string, string> = {
  bad_name: 'signup-name',
  bad_email: 'signup-email',
  bad_password: 'signup-password',
  bad_credentials: 'signin-email',
  bad_code: 'confirm-code',
  code_expired: 'confirm-code',
};

function showAccountError(code: string | undefined, message: string | undefined): void {
  announce('account-status', message ?? copy.photoNetwork);
  if (!code) return;
  const fieldId = FIELD_FOR_CODE[code];
  if (!fieldId) return;
  const field = byId<HTMLInputElement>(fieldId);
  if (!field) return;
  field.setAttribute('aria-invalid', 'true');
  field.focus();
}

function clearInvalid(form: HTMLElement): void {
  for (const field of form.querySelectorAll('[aria-invalid]')) field.removeAttribute('aria-invalid');
}

export function startSignUp(): void {
  const form = need<HTMLFormElement>('signup-form');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit();
  });
  async function submit(): Promise<void> {
    clearInvalid(form);
    const answer = await api('/api/signup', {
      method: 'POST',
      body: {
        name: need<HTMLInputElement>('signup-name').value,
        email: need<HTMLInputElement>('signup-email').value,
        password: need<HTMLInputElement>('signup-password').value,
      },
    });
    if (!answer.ok) {
      showAccountError(answer.body.error, answer.body.message);
      return;
    }
    location.assign('/confirm');
  }
}

export function startSignIn(): void {
  const data = bootstrap<{ next: string }>();
  const form = need<HTMLFormElement>('signin-form');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit();
  });
  async function submit(): Promise<void> {
    clearInvalid(form);
    const answer = await api('/api/session', {
      method: 'POST',
      body: {
        email: need<HTMLInputElement>('signin-email').value,
        password: need<HTMLInputElement>('signin-password').value,
      },
    });
    if (!answer.ok) {
      showAccountError(answer.body.error, answer.body.message);
      return;
    }
    location.assign(/^\/(?!\/)/.test(data.next) ? data.next : '/play');
  }
}

export function startConfirm(): void {
  const form = need<HTMLFormElement>('confirm-form');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit();
  });
  need('resend-code').addEventListener('click', () => void resend());

  async function submit(): Promise<void> {
    clearInvalid(form);
    const answer = await api('/api/confirm', {
      method: 'POST',
      body: { code: need<HTMLInputElement>('confirm-code').value },
    });
    if (!answer.ok) {
      showAccountError(answer.body.error, answer.body.message);
      return;
    }
    announce('account-status', copy.emailConfirmed);
  }

  async function resend(): Promise<void> {
    const answer = await api('/api/confirm/resend', { method: 'POST', body: {} });
    announce('account-status', answer.ok ? copy.newCodeSent : (answer.body.message ?? copy.codeFailed));
  }
}

export function wireAccountMenu(): void {
  const button = byId('account-button');
  const menu = byId('account-menu');
  if (!button || !menu) return;
  button.addEventListener('click', () => {
    const open = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', open ? 'false' : 'true');
    menu.hidden = open;
  });
  byId('sign-out')?.addEventListener('click', () => {
    void api('/api/session', { method: 'DELETE' }).then(() => location.assign('/'));
  });
}
