import { api } from '../api.js';
import { COPY, signedUpLine, tooManyAttempts } from '../copy.js';
import { el } from '../dom.js';
import type { Page } from '../router.js';
import { navigate } from '../router.js';
import { loadSettings, state } from '../state.js';
import { heading, renderShell, showMailOutage } from '../shell.js';

interface Field {
  readonly wrapper: HTMLElement;
  readonly input: HTMLInputElement;
  readonly error: HTMLElement;
}

function field(label: string, type: string): Field {
  const input = el('input', { type, class: 'input', 'aria-label': label }) as HTMLInputElement;
  const error = el('p', { role: 'alert', class: 'field-error' });
  const wrapper = el('label', { class: 'field' }, [
    el('span', {}, [label]),
    input,
    error,
  ]);
  return { wrapper, input, error };
}

function form(children: HTMLElement[], onSubmit: () => void): HTMLFormElement {
  const node = el('form', { class: 'auth-form' }, children) as HTMLFormElement;
  node.addEventListener('submit', (event) => {
    event.preventDefault();
    onSubmit();
  });
  return node;
}

export class SignUpPage implements Page {
  render(container: HTMLElement): void {
    container.textContent = '';
    const folder = el('div', { class: 'folder open' });
    const name = field('Display name', 'text');
    const email = field('Email', 'email');
    const password = field('Password', 'password');
    const submit = el('button', { type: 'submit', class: 'button' }, [
      'Create account',
    ]) as HTMLButtonElement;
    const outcome = el('div', { class: 'outcome' });

    const send = (): void => {
      name.error.textContent = '';
      email.error.textContent = '';
      password.error.textContent = '';
      submit.disabled = true;
      void api
        .post<{ email: string; mail: string; error?: string; errors?: Record<string, string> }>(
          '/api/signup',
          {
            name: name.input.value,
            email: email.input.value,
            password: password.input.value,
          },
        )
        .then(async (response) => {
          submit.disabled = false;
          if (response.status === 201 && response.body) {
            await api.get('/api/me').then((me) => {
              if (me.status === 200) state.session = me.body as typeof state.session;
            });
            await loadSettings();
            renderShell();
            const main = document.getElementById('main');
            if (!main) return;
            main.textContent = '';
            const sheet = el('div', { class: 'folder open' }, [heading(1, COPY.checkEmail)]);
            if (response.body.mail === 'retrying') showMailOutage();
            else sheet.append(el('p', {}, [signedUpLine(response.body.email)]));
            main.append(sheet);
            return;
          }
          if (response.status === 409) {
            email.error.textContent = COPY.emailTaken;
            return;
          }
          const errors = response.body?.errors ?? {};
          if (errors['name']) name.error.textContent = errors['name'];
          if (errors['email']) email.error.textContent = errors['email'];
          if (errors['password']) password.error.textContent = errors['password'];
          if (Object.keys(errors).length === 0) {
            outcome.replaceChildren(el('p', { role: 'alert', class: 'alert' }, [COPY.serverError]));
          }
        });
    };

    folder.append(
      heading(1, 'Create your account'),
      form([name.wrapper, email.wrapper, password.wrapper, submit], send),
      outcome,
    );
    container.append(folder);
  }
}

export class SignInPage implements Page {
  render(container: HTMLElement): void {
    container.textContent = '';
    const folder = el('div', { class: 'folder open' });
    const email = field('Email', 'email');
    const password = field('Password', 'password');
    const submit = el('button', { type: 'submit', class: 'button' }, ['Sign in']) as HTMLButtonElement;
    const outcome = el('div', { class: 'outcome' });

    const send = (): void => {
      submit.disabled = true;
      outcome.textContent = '';
      void api
        .post<{ error?: string; retryAfter?: number }>('/api/session', {
          email: email.input.value,
          password: password.input.value,
        })
        .then(async (response) => {
          submit.disabled = false;
          if (response.status === 200) {
            await api.get('/api/me').then((me) => {
              if (me.status === 200) state.session = me.body as typeof state.session;
            });
            await loadSettings();
            renderShell();
            const back = new URLSearchParams(window.location.search).get('from');
            navigate(back && back.startsWith('/') ? back : '/');
            return;
          }
          if (response.status === 429) {
            outcome.replaceChildren(
              el('p', { role: 'alert', class: 'alert' }, [
                tooManyAttempts(response.body?.retryAfter ?? 60),
              ]),
            );
            return;
          }
          outcome.replaceChildren(
            el('p', { role: 'alert', class: 'alert' }, [
              response.status === 401 ? COPY.wrongSignIn : COPY.serverError,
            ]),
          );
        });
    };

    folder.append(
      heading(1, 'Sign in'),
      form([email.wrapper, password.wrapper, submit], send),
      el('a', { href: '/reset', class: 'link' }, ['Forgot password']),
      outcome,
    );
    container.append(folder);
  }
}

export class ResetRequestPage implements Page {
  render(container: HTMLElement): void {
    container.textContent = '';
    const folder = el('div', { class: 'folder open' });
    const email = field('Email', 'email');
    const submit = el('button', { type: 'submit', class: 'button' }, [
      'Send reset link',
    ]) as HTMLButtonElement;
    const outcome = el('div', { class: 'outcome' });
    const send = (): void => {
      submit.disabled = true;
      void api.post('/api/password-reset', { email: email.input.value }).then(() => {
        submit.disabled = false;
        outcome.replaceChildren(el('p', {}, [COPY.resetRequested]));
      });
    };
    folder.append(
      heading(1, 'Reset your password'),
      form([email.wrapper, submit], send),
      outcome,
    );
    container.append(folder);
  }
}

export class ResetConfirmPage implements Page {
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  render(container: HTMLElement): void {
    container.textContent = '';
    const folder = el('div', { class: 'folder open' });
    const password = field('New password', 'password');
    const submit = el('button', { type: 'submit', class: 'button' }, [
      'Set password',
    ]) as HTMLButtonElement;
    const outcome = el('div', { class: 'outcome' });
    const send = (): void => {
      submit.disabled = true;
      password.error.textContent = '';
      void api
        .post<{ error?: string; errors?: Record<string, string> }>('/api/password-reset/confirm', {
          token: this.token,
          password: password.input.value,
        })
        .then((response) => {
          submit.disabled = false;
          if (response.status === 200) {
            state.session = null;
            renderShell();
            const main = document.getElementById('main');
            if (!main) return;
            main.replaceChildren(
              el('div', { class: 'folder open' }, [
                heading(1, COPY.passwordChanged),
                el('p', {}, [COPY.passwordChangedLine]),
                el('a', { href: '/signin', class: 'link' }, ['Sign in']),
              ]),
            );
            return;
          }
          if (response.status === 410) {
            folder.replaceChildren(
              heading(1, COPY.linkExpired),
              el('p', {}, [COPY.linkExpiredLine]),
            );
            return;
          }
          const message = response.body?.errors?.['password'];
          if (message) password.error.textContent = message;
          else outcome.replaceChildren(el('p', { role: 'alert', class: 'alert' }, [COPY.serverError]));
        });
    };
    folder.append(
      heading(1, 'Set a new password'),
      form([password.wrapper, submit], send),
      outcome,
    );
    container.append(folder);
  }
}

export class VerifyPage implements Page {
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  async render(container: HTMLElement): Promise<void> {
    container.textContent = '';
    const folder = el('div', { class: 'folder open' });
    container.append(folder);
    const response = await api.post<{ verified?: boolean }>('/api/verify', { token: this.token });
    if (response.status === 200) {
      if (state.session) {
        state.session = { ...state.session, verified: true };
        renderShell();
      }
      folder.replaceChildren(heading(1, COPY.verified), el('p', {}, [COPY.verifiedLine]));
      return;
    }
    folder.replaceChildren(heading(1, COPY.linkExpired), el('p', {}, [COPY.linkExpiredLine]));
  }
}

export class NotFoundPage implements Page {
  render(container: HTMLElement): void {
    container.textContent = '';
    container.append(
      el('div', { class: 'folder open' }, [heading(1, COPY.pageNotFound)]),
    );
  }
}
