// The sign-in screen.

import { Session, api } from './api.js';
import { Live } from './shell.js';

export class SignInScreen {
  private submitted = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly live: Live,
    private readonly onSignedIn: (session: Session, returnTo: string) => void,
    private readonly notice: string | null,
  ) {}

  mount(returnTo: string): void {
    this.root.innerHTML = `
      <div class="sign-in-wrap">
        <div class="sign-in panel" role="main">
          <div class="brand">Keelson</div>
          <h1>Sign in to Keelson</h1>
          ${this.notice ? `<p class="note">${this.notice}</p>` : ''}
          <form novalidate>
            <div class="field" data-field="email">
              <label for="email">Email</label>
              <input id="email" name="email" type="email" autocomplete="username">
              <p class="error" hidden></p>
            </div>
            <div class="field" data-field="password">
              <label for="password">Password</label>
              <input id="password" name="password" type="password" autocomplete="current-password">
              <p class="error" hidden></p>
            </div>
            <button class="btn primary" type="submit">Sign in</button>
          </form>
        </div>
      </div>`;
    const form = this.root.querySelector('form')!;
    const email = this.root.querySelector<HTMLInputElement>('#email')!;
    const password = this.root.querySelector<HTMLInputElement>('#password')!;
    const submit = this.root.querySelector<HTMLButtonElement>('button[type=submit]')!;
    email.focus();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (this.submitted) return;
      this.submitted = true;
      submit.disabled = true;
      this.clearErrors();
      this.live.activity('Signing in…');
      try {
        const session = await api.signIn(email.value.trim(), password.value) as Session;
        this.live.activity('');
        this.onSignedIn(session, returnTo);
      } catch (err) {
        if (err instanceof Error && 'status' in err && (err as { status: number }).status === 401) {
          this.live.problem('Email or password is wrong.');
          this.setError('email', 'Email or password is wrong.');
        } else {
          this.live.problem('Keelson could not reach the server. Your last action was not confirmed.');
        }
      } finally {
        this.submitted = false;
        submit.disabled = false;
      }
    });
  }

  private setError(name: string, message: string): void {
    const wrap = this.root.querySelector<HTMLElement>(`[data-field="${name}"]`);
    if (!wrap) return;
    const err = wrap.querySelector<HTMLElement>('.error')!;
    err.textContent = message;
    err.hidden = false;
  }

  private clearErrors(): void {
    this.root.querySelectorAll('.error').forEach((e) => { (e as HTMLElement).hidden = true; });
  }
}
