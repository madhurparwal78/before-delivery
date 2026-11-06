import { h, type VNode } from './jsx/runtime.js';
import { api } from './api.js';
import { store } from './store.js';
import { rerender } from './rerender.js';
import { fmtTime } from '../shared/format.js';
import type { SessionRow } from '../shared/types.js';

/** The account page: two-step, sessions and password. */
export function Account(_props: Record<string, never>): VNode {
  guard();
  const twoStep = store.dialogData['twoStep'] as { enabled: boolean; enabled_at: string | null; recovery_codes_left: number } | null;
  const sessions = store.sessions as SessionRow[];

  return (
    <div class="page-wrap">
      <h2>Account</h2>
      <section class="panel" aria-label="Two-step sign-in">
        <h3>Two-step sign-in</h3>
        {twoStep && twoStep.enabled ? (
          <p>On since {fmtTime(twoStep.enabled_at ?? '')}. {twoStep.recovery_codes_left} recovery codes left.</p>
        ) : null}
        {twoStep && !twoStep.enabled && !store.twoStepSetup ? (
          <button onclick={startSetup}>Turn on two-step sign-in</button>
        ) : null}
        {store.twoStepSetup && !twoStep?.enabled ? (
          <div>
            <label for="ts-key">Setup key</label>
            <input id="ts-key" readonly value={store.twoStepSetup.secret} />
            <p class="hint">{store.twoStepSetup.otpauth_uri}</p>
            <label for="ts-code">Authenticator code</label>
            <input id="ts-code" inputmode="numeric" />
            <div class="auth-actions">
              <button class="primary" onclick={enableTwoStep}>Verify and turn on</button>
            </div>
          </div>
        ) : null}
        {store.recoveryCodes.length > 0 ? (
          <div>
            <ul aria-label="Recovery codes">
              {store.recoveryCodes.map(c => <li key={c} class="mono">{c}</li>)}
            </ul>
          </div>
        ) : null}
        {twoStep?.enabled ? (
          <div>
            <button onclick={() => { store.dialog = 'turn-off-two-step'; rerender(); }}>Turn off two-step sign-in</button>
          </div>
        ) : null}
        <p class="status" data-testid="two-step-status">{store.twoStepStatus}</p>
      </section>
      <section class="panel" aria-label="Sessions">
        <h3>Sessions</h3>
        <table aria-label="Sessions">
          <thead><tr><th>Device</th><th>Signed in (UTC)</th><th>Last seen (UTC)</th><th></th></tr></thead>
          <tbody>
            {sessions.map(s => (
              <tr key={s.id}>
                <td>{s.device}{s.current ? ' · This session' : ''}</td>
                <td class="num">{fmtTime(s.created_at)}</td>
                <td class="num">{fmtTime(s.last_seen_at)}</td>
                <td>{s.current ? null : <button onclick={() => signOutSession(s.id)}>Sign out session from {fmtTime(s.created_at)}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div class="auth-actions">
          <button onclick={signOutOthers}>Sign out other sessions</button>
        </div>
        <p class="status" data-testid="sessions-status">{store.sessionsStatus}</p>
      </section>
      <section class="panel" aria-label="Password">
        <h3>Password</h3>
        <label for="pw-current">Current password</label>
        <input id="pw-current" type="password" autocomplete="current-password" />
        <label for="pw-new">New password</label>
        <input id="pw-new" type="password" autocomplete="new-password" />
        <div class="auth-actions">
          <button class="primary" onclick={changePassword}>Change password</button>
        </div>
        <p class="status" data-testid="password-status">{store.passwordStatus}</p>
      </section>
      {store.dialog === 'turn-off-two-step' ? (
        <DialogBackdrop>
          <div class="dialog-panel" role="dialog" aria-label="Turn off two-step sign-in">
            <h3>Turn off two-step sign-in</h3>
            <label for="to-code">Authenticator code</label>
            <input id="to-code" inputmode="numeric" />
            <div class="dialog-actions">
              <button class="primary" onclick={turnOffTwoStep}>Turn off</button>
              <button onclick={closeDialog}>Cancel</button>
            </div>
          </div>
        </DialogBackdrop>
      ) : null}
    </div>
  );
}

function DialogBackdrop(props: { children?: unknown }): VNode {
  return <div class="dialog-backdrop">{props.children}</div>;
}

export function closeDialog(): void {
  store.dialog = null;
  rerender();
}

function guard(): void {
  if (store.sessions.length === 0 && !store.dialogData['accountLoaded']) {
    store.dialogData = { ...store.dialogData, accountLoaded: true };
    queueMicrotask(async () => {
      const me = await api('GET', '/api/me');
      if (me.status === 401) { location.href = '/signin'; return; }
      if (me.status === 401 + 0 && (me.data as { error?: string }).error === 'two_step_required') { location.href = '/signin'; return; }
      const ts = await api('GET', '/api/me/two-step');
      const ss = await api('GET', '/api/me/sessions');
      store.dialogData = { ...store.dialogData, twoStep: ts.data, accountLoaded: true };
      store.sessions = (ss.data as { sessions: SessionRow[] }).sessions ?? [];
      rerender();
    });
  }
}

async function startSetup(): Promise<void> {
  const r = await api('POST', '/api/me/two-step/setup');
  if (r.status === 200) {
    store.twoStepSetup = r.data as { secret: string; otpauth_uri: string };
    store.twoStepStatus = 'Add this key to your authenticator app, then enter the code it shows.';
    rerender();
  } else {
    store.twoStepStatus = 'Two-step sign-in is already on.';
    rerender();
  }
}

async function enableTwoStep(): Promise<void> {
  const code = (document.getElementById('ts-code') as HTMLInputElement)?.value ?? '';
  store.twoStepStatus = 'Checking code…';
  rerender();
  const r = await api('POST', '/api/me/two-step/enable', { code });
  if (r.status === 200) {
    store.recoveryCodes = (r.data as { recovery_codes: string[] }).recovery_codes ?? [];
    store.twoStepSetup = null;
    store.twoStepStatus = "Two-step sign-in is on. Save your recovery codes now; Farshore won't show them again.";
    const ts = await api('GET', '/api/me/two-step');
    store.dialogData = { ...store.dialogData, twoStep: ts.data };
    rerender();
  } else {
    const errors = (r.data as { errors?: Record<string, string> }).errors ?? {};
    store.twoStepStatus = errors.code ?? "That code didn't work. Use the current code from your app.";
    rerender();
  }
}

async function turnOffTwoStep(): Promise<void> {
  const code = (document.getElementById('to-code') as HTMLInputElement)?.value ?? '';
  const r = await api('DELETE', '/api/me/two-step', { code });
  if (r.status === 204) {
    store.dialog = null;
    store.twoStepStatus = 'Two-step sign-in is off.';
    const ts = await api('GET', '/api/me/two-step');
    store.dialogData = { ...store.dialogData, twoStep: ts.data };
    rerender();
  } else {
    const errors = (r.data as { errors?: Record<string, string> }).errors ?? {};
    store.twoStepStatus = errors.code ?? errors.recovery_code ?? "That code didn't work.";
    rerender();
  }
}

async function signOutSession(id: string): Promise<void> {
  const r = await api('DELETE', `/api/me/sessions/${id}`);
  if (r.status === 204) {
    store.sessionsStatus = 'Session signed out.';
    const ss = await api('GET', '/api/me/sessions');
    store.sessions = (ss.data as { sessions: SessionRow[] }).sessions ?? [];
    rerender();
  }
}

async function signOutOthers(): Promise<void> {
  const r = await api<{ ended: number }>('POST', '/api/me/sessions/sign-out-others');
  store.sessionsStatus = r.status === 200 ? `Signed out ${r.data.ended} other ${r.data.ended === 1 ? 'session' : 'sessions'}.` : '';
  const ss = await api('GET', '/api/me/sessions');
  store.sessions = (ss.data as { sessions: SessionRow[] }).sessions ?? [];
  rerender();
}

async function changePassword(): Promise<void> {
  const current = (document.getElementById('pw-current') as HTMLInputElement)?.value ?? '';
  const next = (document.getElementById('pw-new') as HTMLInputElement)?.value ?? '';
  store.passwordStatus = 'Changing password…';
  rerender();
  const r = await api<{ ended_sessions: number }>('PUT', '/api/me/password', { current_password: current, new_password: next });
  if (r.status === 200) {
    const n = r.data.ended_sessions;
    store.passwordStatus = `Password changed. ${n} other ${n === 1 ? 'session' : 'sessions'} signed out.`;
    const pwCur = document.getElementById('pw-current') as HTMLInputElement | null;
    const pwNew = document.getElementById('pw-new') as HTMLInputElement | null;
    if (pwCur) pwCur.value = '';
    if (pwNew) pwNew.value = '';
    rerender();
  } else if (r.status === 401) {
    store.passwordStatus = 'Your current password is incorrect.';
    rerender();
  } else if (r.status === 429) {
    const secs = (r.data as { retry_after_seconds?: number }).retry_after_seconds ?? 1;
    store.passwordStatus = `Too many sign-in attempts. Try again in ${secs} seconds.`;
    rerender();
  } else {
    const errors = (r.data as { errors?: Record<string, string> }).errors ?? {};
    store.passwordStatus = errors.new_password ?? 'The password could not be changed.';
    rerender();
  }
}
