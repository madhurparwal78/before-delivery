import { h, type VNode } from './jsx/runtime.js';
import { api } from './api.js';
import { store } from './store.js';
import { rerender } from './rerender.js';

/** The accept-invite page. */
export function Invite(props: { token: string }): VNode {
  if (!store.inviteData) {
    queueMicrotask(async () => {
      const r = await api('GET', `/api/invites/${props.token}`);
      if (r.status === 200) {
        store.inviteData = r.data as Record<string, unknown>;
      } else if (r.status === 410) {
        store.inviteData = { expired: true };
      } else {
        store.inviteData = { missing: true };
      }
      rerender();
    });
    return <div class="auth-wrap"><main class="panel auth-panel"><p>Loading…</p></main></div>;
  }
  const data = store.inviteData;
  if (data['expired']) {
    return <div class="auth-wrap"><main class="panel auth-panel"><h2>Join {String((data['workspace'] as { name?: string })?.name ?? 'the workspace')}</h2><p class="alert" role="alert">This invite has expired. Ask the workspace owner for a new one.</p></main></div>;
  }
  if (data['missing']) {
    return <div class="auth-wrap"><main class="panel auth-panel"><p>This invite is no longer available.</p></main></div>;
  }
  const existing = Boolean(data['existing_account']);
  const ws = data['workspace'] as { name: string; slug: string };

  const accept = async (): Promise<void> => {
    const name = (document.getElementById('iv-name') as HTMLInputElement)?.value ?? '';
    const password = (document.getElementById('iv-password') as HTMLInputElement)?.value ?? '';
    const body = existing ? { password } : { name, password };
    const r = await api('POST', `/api/invites/${props.token}/accept`, body);
    if (r.status === 201 || r.status === 200) {
      location.href = '/console';
      return;
    }
    if (r.status === 202) {
      location.href = '/signin';
      return;
    }
    if (r.status === 429) {
      const secs = (r.data as { retry_after_seconds?: number }).retry_after_seconds ?? 1;
      store.alertMessage = `Too many sign-in attempts. Try again in ${secs} seconds.`;
      rerender();
      return;
    }
    if (r.status === 401) {
      store.alertMessage = "That password doesn't match your Farshore account.";
      rerender();
      return;
    }
    if (r.status === 410) {
      store.alertMessage = 'This invite has expired. Ask the workspace owner for a new one.';
      rerender();
      return;
    }
    const errors = (r.data as { errors?: Record<string, string> }).errors ?? {};
    store.alertMessage = errors.password ?? errors.name ?? 'The invite could not be accepted.';
    rerender();
  };

  return (
    <div class="auth-wrap">
      <main class="panel auth-panel">
        <h2>Join {ws.name}</h2>
        <p class="hint">Invited as {String(data['email'])} · role {String(data['role'])}</p>
        {existing ? null : (<div><label for="iv-name">Your name</label><input id="iv-name" /></div>)}
        <label for="iv-password">Password</label>
        <input id="iv-password" type="password" />
        <div class="auth-actions">
          <button class="primary" onclick={accept}>Join workspace</button>
        </div>
        <p class="alert" role="alert">{store.alertMessage}</p>
      </main>
    </div>
  );
}
