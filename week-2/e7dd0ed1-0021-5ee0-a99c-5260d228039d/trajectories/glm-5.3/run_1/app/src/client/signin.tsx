import { h, type VNode } from './jsx/runtime.js';
import { api } from './api.js';
import { store } from './store.js';
import { rerender } from './rerender.js';

/** The sign-in panel with its password, code and recovery steps. */
export function SignIn(_props: Record<string, never>): VNode {
  const step = store.signInStep;
  const landing = sessionStorage.getItem('fs_after') ?? '/console';

  const signIn = async (): Promise<void> => {
    store.signInPending = true;
    store.alertMessage = '';
    rerender();
    const email = (document.getElementById('si-email') as HTMLInputElement)?.value ?? '';
    const password = (document.getElementById('si-password') as HTMLInputElement)?.value ?? '';
    const r = await api('POST', '/api/session', { email, password });
    store.signInPending = false;
    if (r.status === 200) {
      store.signInStep = 'password';
      location.href = landing;
      return;
    }
    if (r.status === 202) {
      store.signInStep = 'code';
      store.alertMessage = '';
      rerender();
      return;
    }
    if (r.status === 429) {
      const secs = (r.data as { retry_after_seconds?: number }).retry_after_seconds ?? 1;
      store.alertMessage = `Too many sign-in attempts. Try again in ${secs} seconds.`;
      rerender();
      return;
    }
    if (r.status === 503) {
      store.alertMessage = "Farshore can't reach storage right now. Nothing was changed; try again in a minute.";
      rerender();
      return;
    }
    store.alertMessage = 'Email or password is incorrect.';
    rerender();
  };

  const verifyCode = async (recovery: boolean): Promise<void> => {
    store.signInPending = true;
    store.alertMessage = '';
    rerender();
    const code = (document.getElementById('si-code') as HTMLInputElement)?.value ?? '';
    const rec = (document.getElementById('si-recovery') as HTMLInputElement)?.value ?? '';
    const r = await api('POST', '/api/session/two-step', recovery ? { recovery_code: rec } : { code });
    store.signInPending = false;
    if (r.status === 200) {
      location.href = landing;
      return;
    }
    if (r.status === 429) {
      const secs = (r.data as { retry_after_seconds?: number }).retry_after_seconds ?? 1;
      store.alertMessage = `Too many sign-in attempts. Try again in ${secs} seconds.`;
      rerender();
      return;
    }
    if (r.status === 401) {
      store.signInStep = 'password';
      store.alertMessage = 'This sign-in has expired. Enter your email and password again.';
      rerender();
      return;
    }
    const errors = (r.data as { errors?: Record<string, string> }).errors ?? {};
    store.alertMessage = errors.code ?? errors.recovery_code ?? "That code didn't work.";
    rerender();
  };

  return (
    <div class="auth-wrap">
      <main class="panel auth-panel">
        {step === 'password' ? (
          <div>
            <h2>Sign in to Farshore</h2>
            <label for="si-email">Email</label>
            <input id="si-email" type="email" autocomplete="username" />
            <label for="si-password">Password</label>
            <input id="si-password" type="password" autocomplete="current-password" />
            <div class="auth-actions">
              <button id="si-submit" class="primary" disabled={store.signInPending} onclick={signIn}>
                {store.signInPending ? 'Signing in…' : 'Sign in'}
              </button>
            </div>
          </div>
        ) : null}
        {step === 'code' ? (
          <div>
            <h2>Enter the code from your authenticator app</h2>
            <p class="hint">Codes change every 30 seconds.</p>
            <label for="si-code">Authenticator code</label>
            <input id="si-code" inputmode="numeric" />
            <div class="auth-actions">
              <button id="si-verify" class="primary" disabled={store.signInPending} onclick={() => verifyCode(false)}>
                {store.signInPending ? 'Verifying…' : 'Verify'}
              </button>
              <button onclick={() => { store.signInStep = 'recovery'; rerender(); }}>Use a recovery code</button>
            </div>
          </div>
        ) : null}
        {step === 'recovery' ? (
          <div>
            <h2>Enter one of your recovery codes</h2>
            <label for="si-recovery">Recovery code</label>
            <input id="si-recovery" />
            <div class="auth-actions">
              <button class="primary" disabled={store.signInPending} onclick={() => verifyCode(true)}>Verify</button>
              <button onclick={() => { store.signInStep = 'code'; rerender(); }}>Use an authenticator code</button>
            </div>
          </div>
        ) : null}
        <p class="alert" role="alert">{store.alertMessage}</p>
      </main>
    </div>
  );
}
