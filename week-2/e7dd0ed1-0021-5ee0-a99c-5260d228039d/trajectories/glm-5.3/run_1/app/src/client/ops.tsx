import { h, type VNode } from './jsx/runtime.js';
import { api } from './api.js';
import { store } from './store.js';
import { rerender } from './rerender.js';
import { fmtInt, fmtTime } from '../shared/format.js';
import type { OpsRegion, OpsWorkspace } from '../shared/types.js';

/** The operator console: regions, workspaces and billing. */
export function Ops(props: { path: string }): VNode {
  const section = props.path === '/ops' || props.path === '/ops/regions' ? 'regions'
    : props.path === '/ops/workspaces' ? 'workspaces'
    : props.path === '/ops/billing' ? 'billing' : 'regions';
  if (!store.me) {
    queueMicrotask(async () => {
      const r = await api('GET', '/api/me');
      if (r.status !== 200) { location.href = '/signin'; return; }
      store.me = r.data;
      if (!store.me?.user.operator) { location.href = '/console'; return; }
      await refreshAll();
      rerender();
    });
    return <div class="page-wrap"><p>Checking your access…</p></div>;
  }
  return (
    <div class="console" style="grid-template-columns:240px 1fr">
      <aside class="rail">
        <p class="ws-name">Farshore</p>
        <nav aria-label="Operator">
          <h3>Operator</h3>
          <a href="/ops/regions" aria-current={section === 'regions' ? 'page' : undefined}>Regions</a>
          <a href="/ops/workspaces" aria-current={section === 'workspaces' ? 'page' : undefined}>Workspaces</a>
          <a href="/ops/billing" aria-current={section === 'billing' ? 'page' : undefined}>Billing</a>
        </nav>
        <div class="rail-foot">
          <a href="/account">Account</a>
          <button onclick={signOut}>Sign out</button>
        </div>
      </aside>
      <main class="centre">
        {section === 'regions' ? Regions() : null}
        {section === 'workspaces' ? Workspaces() : null}
        {section === 'billing' ? Billing() : null}
        <p class="status" data-testid="operator-status">{store.operatorStatus}</p>
      </main>
    </div>
  );
}

function Regions(): VNode {
  return (
    <div class="panel" aria-label="Regions">
      <h3>Regions</h3>
      <button class="primary" onclick={runLifecycle}>Run lifecycle now</button>
      <table aria-label="Region backlog" style="margin-top:14px">
        <thead><tr><th>Region</th><th>State</th><th class="num">Pending</th><th class="num">Failed</th><th class="num">Oldest pending</th><th></th></tr></thead>
        <tbody>
          {store.opsRegions.map(r => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td>{r.state}</td>
              <td class="num">{fmtInt(r.pending)}</td>
              <td class="num">{fmtInt(r.failed)}</td>
              <td class="num">{r.oldest_pending_ms === null ? '—' : `${fmtInt(r.oldest_pending_ms)} ms`}</td>
              <td>
                {r.state === 'online'
                  ? <button onclick={() => setRegion(r.id, r.name, 'offline')}>Take {r.name} offline</button>
                  : <button onclick={() => setRegion(r.id, r.name, 'online')}>Bring {r.name} online</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Workspaces(): VNode {
  return (
    <div class="panel" aria-label="Workspaces">
      <h3>Workspaces</h3>
      <table aria-label="Workspaces">
        <thead><tr><th>Name</th><th>Slug</th><th>Plan</th><th class="num">Members</th><th class="num">Buckets</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {store.opsWorkspaces.map(w => (
            <tr key={w.slug}>
              <td>{w.name}</td>
              <td>{w.slug}</td>
              <td>{w.plan}</td>
              <td class="num">{fmtInt(w.members)}</td>
              <td class="num">{fmtInt(w.buckets)}</td>
              <td>{w.status}</td>
              <td>
                {w.status === 'active'
                  ? <button onclick={() => { store.dialog = 'suspend'; store.dialogData = { ...store.dialogData, suspendSlug: w.slug, suspendName: w.name }; rerender(); }}>Suspend {w.name}</button>
                  : <button onclick={() => reinstate(w.slug, w.name)}>Reinstate {w.name}</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {store.dialog === 'suspend' ? (
        <div class="dialog-backdrop">
          <div class="dialog-panel" role="dialog" aria-label="Suspend workspace">
            <h3>Suspend workspace</h3>
            <label for="suspend-reason">Reason</label>
            <input id="suspend-reason" value={String(store.dialogData['suspendReason'] ?? '')}
              oninput={(e: Event) => { store.dialogData = { ...store.dialogData, suspendReason: (e.target as HTMLInputElement).value }; }} />
            <div class="dialog-actions">
              <button class="primary" onclick={suspend}>Suspend</button>
              <button onclick={() => { store.dialog = null; rerender(); }}>Cancel</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Billing(): VNode {
  const b = store.opsBilling;
  return (
    <div class="panel" aria-label="Billing">
      <h3>Billing</h3>
      <button class="primary" onclick={syncBilling}>Sync billing now</button>
      <table style="margin-top:14px">
        <tbody>
          <tr><th>State</th><td>{b?.state ?? ''}</td></tr>
          <tr><th>Queued rows</th><td class="num">{fmtInt(b?.queued_rows ?? 0)}</td></tr>
          <tr><th>Posted rows</th><td class="num">{fmtInt(b?.posted_rows ?? 0)}</td></tr>
          <tr><th>Last attempt</th><td class="num">{b?.last_attempt_at ? fmtTime(b.last_attempt_at) : '—'}</td></tr>
          <tr><th>Last error</th><td>{b?.last_error ?? '—'}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

let polling = false;
async function refreshAll(): Promise<void> {
  const rs = await api<{ regions: OpsRegion[] }>('GET', '/api/ops/regions');
  if (rs.status === 200) store.opsRegions = rs.data.regions;
  const ws = await api<{ workspaces: OpsWorkspace[] }>('GET', '/api/ops/workspaces');
  if (ws.status === 200) store.opsWorkspaces = ws.data.workspaces;
  const b = await api('GET', '/api/ops/billing');
  if (b.status === 200) store.opsBilling = b.data as typeof store.opsBilling;
  if (!polling) {
    polling = true;
    setInterval(async () => {
      const which = new URL(location.href).pathname;
      if (!which.startsWith('/ops')) return;
      await refreshAll();
      rerender();
    }, 2000);
  }
}

async function setRegion(id: string, name: string, state: 'online' | 'offline'): Promise<void> {
  const r = await api('POST', `/api/ops/regions/${id}/state`, { state });
  if (r.status === 200) {
    store.operatorStatus = `${name} is now ${state}.`;
  } else if (r.status === 409) {
    store.operatorStatus = "That change isn't allowed from the current state.";
  }
  await refreshAll();
  rerender();
}

async function runLifecycle(): Promise<void> {
  const r = await api<{ expired_versions: number; aborted_uploads: number; skipped_locked: number }>('POST', '/api/ops/lifecycle/run');
  if (r.status === 200) {
    const d = r.data;
    store.operatorStatus = `Lifecycle run: ${d.expired_versions} versions expired, ${d.aborted_uploads} uploads aborted, ${d.skipped_locked} held versions skipped.`;
    rerender();
  }
}

async function suspend(): Promise<void> {
  const slug = String(store.dialogData['suspendSlug']);
  const name = String(store.dialogData['suspendName']);
  const reason = String(store.dialogData['suspendReason'] ?? '');
  const r = await api('POST', `/api/ops/workspaces/${slug}/suspend`, { reason });
  if (r.status === 200) {
    store.dialog = null;
    store.operatorStatus = `${name} suspended.`;
  } else if (r.status === 409) {
    store.operatorStatus = "That change isn't allowed from the current state.";
  }
  await refreshAll();
  rerender();
}

async function reinstate(slug: string, name: string): Promise<void> {
  const r = await api('POST', `/api/ops/workspaces/${slug}/reinstate`);
  if (r.status === 200) store.operatorStatus = `${name} reinstated.`;
  else if (r.status === 409) store.operatorStatus = "That change isn't allowed from the current state.";
  await refreshAll();
  rerender();
}

async function syncBilling(): Promise<void> {
  const r = await api<{ posted: number; queued: number }>('POST', '/api/ops/billing/sync');
  if (r.status === 200 || r.status === 202) {
    store.operatorStatus = `Billing sync: ${r.data.posted} rows posted, ${r.data.queued} still queued.`;
  }
  await refreshAll();
  rerender();
}

function signOut(): void {
  queueMicrotask(async () => { await api('DELETE', '/api/session'); location.href = '/signin'; });
}
