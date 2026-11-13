import { failureOf, ok, request } from '../api.js';
import { copy, waitMessage, waitTimeSentence } from '../copy.js';
import { announce, focusWithoutScroll } from '../dom.js';
import type { SessionInfo } from '../types.js';

export function renderSignIn(root: HTMLElement, endedSession: boolean): void {
  root.innerHTML = `
    <main class="sign-in">
      <h1>Sign in</h1>
      <form class="form-block" data-form>
        <div class="field">
          <label for="email">Email</label>
          <input id="email" type="email" aria-label="Email" autocomplete="username" data-email>
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input id="password" type="password" aria-label="Password" autocomplete="current-password" data-password>
        </div>
        <button type="submit" data-submit>Sign in</button>
      </form>
      <div role="status" aria-label="Sign-in status" data-status></div>
      <div role="timer" aria-label="Wait time" data-wait hidden></div>
      <p><a href="/">Back to the hoarding</a></p>
    </main>
  `;
  const form = root.querySelector('[data-form]') as HTMLFormElement;
  const email = root.querySelector('[data-email]') as HTMLInputElement;
  const password = root.querySelector('[data-password]') as HTMLInputElement;
  const submit = root.querySelector('[data-submit]') as HTMLButtonElement;
  const status = root.querySelector('[data-status]') as HTMLElement;
  const wait = root.querySelector('[data-wait]') as HTMLElement;
  let waiting = false;

  if (endedSession) status.textContent = copy.endedSession;

  function startWait(seconds: number): void {
    waiting = true;
    submit.setAttribute('aria-disabled', 'true');
    announce(status, waitMessage(seconds));
    wait.hidden = false;
    let left = seconds;
    wait.textContent = waitTimeSentence(left);
    const timer = window.setInterval(() => {
      left -= 1;
      if (left <= 0) {
        window.clearInterval(timer);
        wait.hidden = true;
        wait.textContent = '';
        waiting = false;
        submit.removeAttribute('aria-disabled');
        if (status.textContent === waitMessage(seconds)) status.textContent = '';
        return;
      }
      wait.textContent = waitTimeSentence(left);
    }, 1000);
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (waiting) return;
    announce(status, 'Signing in.');
    void request<SessionInfo>('POST', '/api/session', {
      body: { email: email.value, password: password.value },
      silentAuth: true,
    })
      .then((result) => {
        if (result.status === 429) {
          startWait(result.retryAfter ?? 60);
          return;
        }
        if (!ok(result)) {
          announce(status, failureOf(result).message);
          focusWithoutScroll(email);
          return;
        }
        window.location.assign(result.body.role === 'editor' ? '/editor' : '/stockist');
      })
      .catch(() => {
        announce(status, copy.badCredentials);
      });
  });
}
