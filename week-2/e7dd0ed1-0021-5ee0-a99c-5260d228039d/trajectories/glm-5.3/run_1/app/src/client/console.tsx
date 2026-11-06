import { h, type VNode } from './jsx/runtime.js';
import { api, uploadObject, qs } from './api.js';
import { store } from './store.js';
import { rerender } from './rerender.js';
import { fmtInt, fmtTime, shortVersion } from '../shared/format.js';
import type { Bucket, ListItem, VersionInfo, AccessKey, WebhookEndpoint, Delivery, ShareLink, Member, Invite, UsageView, UsageRow, AuditEntry, EncryptionView, ReplicaState } from '../shared/types.js';
import { replicaListLine, releaseReadiness, versionListItem, billingSyncLine, copy } from './copy.js';

const RESERVED = new Set(['share-links', 'team', 'access-keys', 'usage', 'webhooks', 'deliveries', 'security']);

/** The multi-tenant console: rail, object view, inspector and centre pages. */
export function Console(props: { path: string; query: URLSearchParams }): VNode {
  if (!store.me) {
    queueMicrotask(async () => {
      const r = await api('GET', '/api/me');
      if (r.status !== 200) {
        sessionStorage.setItem('fs_after', location.pathname + location.search);
        location.href = '/signin';
        return;
      }
      store.me = r.data;
      if (store.me?.user.operator) { location.href = '/ops'; return; }
      const parts = props.path.split('/').filter(Boolean);
      if (parts.length >= 1 && parts[0] === 'console' && parts.length === 1) {
        // default: first bucket of the first workspace by name
        const first = store.me.memberships[0];
        if (first) {
          const bs = await api<{ buckets: Bucket[] }>('GET', `/api/w/${first.workspace.slug}/buckets`);
          const firstBucket = bs.data.buckets?.[0];
          location.href = `/console/${first.workspace.slug}/${firstBucket?.name ?? ''}`;
          return;
        }
      }
      await loadWorkspaceData(props.path);
      rerender();
    });
    return <div class="page-wrap"><p>Opening the console…</p></div>;
  }
  const parts = props.path.split('/').filter(Boolean); // ['console', ws, ...]
  const ws = parts[1] ?? store.me?.memberships[0]?.workspace.slug ?? '';
  const rest = parts.slice(2);
  const page = rest.length === 0 ? 'objects' : RESERVED.has(rest[0]) ? rest[0] : 'objects';
  const bucketName = page === 'objects' ? (rest[0] ?? '') : '';
  const membership = store.me?.memberships.find(m => m.workspace.slug === ws);
  const role = membership?.role ?? 'viewer';

  if (!membership) {
    return (
      <div class="console">
        {Rail(ws, '', role, false)}
        <main class="centre">
          <h2>Objects</h2>
          <p class="status">This bucket isn't in your workspace.</p>
          <table aria-label="Objects"><tbody></tbody></table>
        </main>
      </div>
    );
  }

  const suspended = Boolean(store.dialogData['wsSuspended']);
  return (
    <div class={store.inspectorKey ? 'console with-inspector' : 'console'}>
      <a class="skip" href="#objects">Skip to objects</a>
      {Rail(ws, bucketName, role, true)}
      <main class="centre" id="objects">
        {suspended ? <div class="suspend-alert" role="alert">{copy.suspendedBanner}</div> : null}
        {page === 'objects' ? ObjectView(ws, bucketName, role, props.query) : null}
        {page === 'share-links' ? ShareLinksPage(ws) : null}
        {page === 'team' ? TeamPage(ws) : null}
        {page === 'access-keys' ? AccessKeysPage(ws) : null}
        {page === 'usage' ? UsagePage(ws) : null}
        {page === 'webhooks' ? WebhooksPage(ws) : null}
        {page === 'deliveries' ? DeliveriesPage(ws, rest[1] ?? '') : null}
        {page === 'security' ? SecurityPage(ws, props.query) : null}
      </main>
      {store.inspectorKey ? Inspector(ws, bucketName, role) : null}
      {store.dialog ? Dialogs(ws, bucketName, role) : null}
      {store.navOpen ? NavDialog(ws, bucketName, role) : null}
    </div>
  );
}

function Rail(ws: string, bucket: string, role: string, buttons: boolean): VNode {
  const me = store.me!;
  const wsName = me.memberships.find(m => m.workspace.slug === ws)?.workspace.name ?? '';
  const regionNames = (ids: string[]): string => ids.map(id => store.regions.find(r => r.id === id)?.name ?? id).join(', ');
  const navLinks = ['Objects', 'Share links', 'Team', 'Access keys', 'Usage', 'Webhooks', 'Security'].map(label => {
    const slugMap: Record<string, string> = { 'Objects': '', 'Share links': 'share-links', 'Team': 'team', 'Access keys': 'access-keys', 'Usage': 'usage', 'Webhooks': 'webhooks', 'Security': 'security' };
    const slug = slugMap[label];
    const href = slug === '' ? `/console/${ws}` : `/console/${ws}/${slug}`;
    const ownerOnly = ['Team', 'Access keys', 'Usage', 'Webhooks', 'Security'].includes(label);
    if (ownerOnly && role !== 'owner') return null;
    return <a key={label} href={href} aria-current={slug === '' && bucket !== '' ? undefined : undefined}>{label}</a>;
  }).filter(Boolean);
  return (
    <aside class="rail">
      <button class="rail-toggle" onclick={() => { store.navOpen = true; rerender(); }}>Workspaces and buckets</button>
      <p class="ws-name">{wsName}</p>
      <nav aria-label="Buckets">
        <h3>Buckets</h3>
        {store.buckets.map(b => (
          <a key={b.name} href={`/console/${ws}/${b.name}`} aria-current={b.name === bucket ? 'page' : undefined}>
            <span>{b.name}<span class="placement">{regionNames(b.placement)}</span></span>
          </a>
        ))}
        {role !== 'viewer' && buttons ? <button class="new-bucket" onclick={() => { store.dialog = 'new-bucket'; rerender(); }}>New bucket</button> : null}
      </nav>
      <nav aria-label="Workspace">
        <h3>Workspace</h3>
        {navLinks}
      </nav>
      <div class="rail-foot">
        <a href="/account">Account</a>
        <button onclick={() => queueMicrotask(async () => { await api('DELETE', '/api/session'); location.href = '/signin'; })}>Sign out</button>
      </div>
    </aside>
  );
}

function NavDialog(ws: string, bucket: string, role: string): VNode {
  return (
    <div class="dialog-backdrop">
      <div class="dialog-panel" role="dialog" aria-label="Navigation">
        <button onclick={() => { store.navOpen = false; rerender(); }}>Close navigation</button>
        {Rail(ws, bucket, role, false)}
      </div>
    </div>
  );
}

// ---------- Object view ----------

let selection = new Set<string>();

function ObjectView(ws: string, bucket: string, role: string, query: URLSearchParams): VNode {
  const canWrite = role === 'developer' || role === 'owner';
  const prefix = query.get('prefix') ?? '';
  const tagFilter = query.get('tag_filter') ?? '';
  const cursor = query.get('cursor');
  const objectKey = query.get('object');
  const itemRows = store.items.length + store.commonPrefixes.length;
  const resultsCopy = store.resultsStatus || (itemRows === 0 ? 'No objects match.' : `${fmtInt(itemRows)} objects on this page`);

  // Load on address change.
  queueMicrotask(async () => { await loadBucketView(ws, bucket, query); });

  return (
    <div>
      <div class="centre-head">
        <h2 id="bucket-heading">{bucket}</h2>
        <span class="breadcrumb">{prefix}</span>
      </div>
      <div class="toolbar">
        <input class="searchbox" type="search" placeholder="Search objects" aria-label="Search objects" id="tb-search" />
        <input placeholder="Prefix" aria-label="Prefix" id="tb-prefix" value={prefix} />
        <input placeholder="env=qa and not team=art" aria-label="Tag filter" id="tb-tag" value={tagFilter} />
        <button onclick={() => applyFilters(ws, bucket)}>Apply filters</button>
        {canWrite ? <button onclick={() => { store.dialog = 'upload'; rerender(); }}>Upload files</button> : null}
        {canWrite ? <button disabled={selection.size === 0} onclick={() => { store.dialog = 'delete-objects'; rerender(); }}>Delete selected</button> : null}
        {canWrite ? <button onclick={() => openLifecycle(ws, bucket)}>Lifecycle rules</button> : null}
      </div>
      {store.deleteResults.length > 0 ? (
        <div>
          <ul aria-label="Delete results">
            {store.deleteResults.map(r => <li key={r.key}>{r.key}: {r.outcome}</li>)}
          </ul>
          {store.undoAvailable ? <button onclick={() => undoDelete(ws, bucket)}>Undo delete</button> : null}
          <p class="status" data-testid="delete-status">{store.deleteStatus}</p>
        </div>
      ) : null}
      <div class="objtable-wrap dropzone"
        ondragover={(e: Event) => { e.preventDefault(); (e.currentTarget as HTMLElement).classList.add('dragover'); }}
        ondragleave={(e: Event) => { (e.currentTarget as HTMLElement).classList.remove('dragover'); }}
        ondrop={(e: Event) => { e.preventDefault(); (e.currentTarget as HTMLElement).classList.remove('dragover'); if (canWrite) startUploadFromFiles(ws, bucket, Array.from((e as DragEvent).dataTransfer?.files ?? [])); }}>
        <table class="objects" aria-label="Objects">
          <thead>
            <tr>
              {canWrite ? <th><input type="checkbox" aria-label="Select all on this page" onchange={selectAll} /></th> : null}
              <th>Key</th>
              <th class="num">Size (bytes)</th>
              <th class="num hide-sm">Last modified (UTC)</th>
              <th>Regions</th>
              <th class="num hide-sm">ETag</th>
            </tr>
          </thead>
          <tbody>
            {store.commonPrefixes.map(cp => (
              <tr key={'cp:' + cp} class="folder-row">
                {canWrite ? <td></td> : null}
                <td colspan="5"><button class="linklike" onclick={() => openFolder(ws, bucket, cp, tagFilter)}>Open folder {cp}</button></td>
              </tr>
            ))}
            {store.items.map(it => (
              <tr key={it.key}>
                {canWrite ? (
                  <td><input type="checkbox" aria-label={`Select ${it.key}`} checked={selection.has(it.key)} onchange={() => toggleSelect(it.key)} /></td>
                ) : null}
                <td><button class="linklike" onclick={() => openObject(ws, bucket, it.key)}>Open {it.key}</button></td>
                <td class="num">{fmtInt(it.size)}</td>
                <td class="num hide-sm">{fmtTime(it.last_modified)}</td>
                <td>{fmtInt(it.replicas_settled)}/{fmtInt(it.replicas_total)}</td>
                <td class="num hide-sm">{it.etag.replace(/"/g, '').slice(0, 8)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div class="pager">
        <button disabled={!canGoBack()} onclick={() => pageBack(ws, bucket, prefix, tagFilter, cursor)}>Previous page</button>
        <button disabled={!store.nextCursor} onclick={() => pageNext(ws, bucket, prefix, tagFilter, cursor)}>Next page</button>
        <p class="status" data-testid="results-status">{resultsCopy}</p>
      </div>
      <p class="status" data-testid="bucket-status">{store.bucketStatus}</p>
      <p class="status" data-testid="upload-status">{store.uploadStatus}</p>
      {store.uploadProgress > 0 ? (
        <progress class="upload-progress" aria-label="Upload progress" max="100" value={store.uploadProgress} />
      ) : null}
      <p class="status" data-testid="lifecycle-status">{store.lifecycleStatus}</p>
      {objectKey && !store.inspectorKey ? <p class="status">No object {objectKey} in {bucket}.</p> : null}
    </div>
  );
}

function canGoBack(): boolean {
  const prevs = new URL(location.href).searchParams.getAll('prev');
  return prevs.length > 0;
}

function pageBack(ws: string, bucket: string, prefix: string, tagFilter: string, cursor: string | null): void {
  const url = new URL(location.href);
  const prevs = url.searchParams.getAll('prev');
  prevs.pop();
  const prevCursor = prevs.length > 0 ? prevs[prevs.length - 1] : null;
  url.searchParams.delete('cursor');
  url.searchParams.delete('prev');
  prevs.forEach(p => url.searchParams.append('prev', p));
  if (prevCursor !== null && prevCursor !== '') url.searchParams.set('cursor', prevCursor);
  history.pushState(null, '', url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : ''));
}

function pageNext(ws: string, bucket: string, prefix: string, tagFilter: string, cursor: string | null): void {
  const url = new URL(location.href);
  const prevs = url.searchParams.getAll('prev');
  prevs.push(cursor ?? '');
  url.searchParams.delete('prev');
  prevs.forEach(p => url.searchParams.append('prev', p));
  if (store.nextCursor) url.searchParams.set('cursor', store.nextCursor);
  history.pushState(null, '', url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : ''));
  void ws; void bucket; void prefix; void tagFilter;
}

function applyFilters(ws: string, bucket: string): void {
  const prefix = (document.getElementById('tb-prefix') as HTMLInputElement)?.value ?? '';
  const tag = (document.getElementById('tb-tag') as HTMLInputElement)?.value ?? '';
  const params = new URLSearchParams();
  if (prefix) params.set('prefix', prefix);
  if (tag) params.set('tag_filter', tag);
  params.set('delimiter', '/');
  selection = new Set();
  history.pushState(null, '', `/console/${ws}/${bucket}${params.toString() ? '?' + params.toString() : ''}`);
}

function openFolder(ws: string, bucket: string, cp: string, tagFilter: string): void {
  const params = new URLSearchParams();
  params.set('prefix', cp);
  if (tagFilter) params.set('tag_filter', tagFilter);
  params.set('delimiter', '/');
  selection = new Set();
  history.pushState(null, '', `/console/${ws}/${bucket}?${params.toString()}`);
}

function toggleSelect(key: string): void {
  if (selection.has(key)) selection.delete(key); else selection.add(key);
  rerender();
}

function selectAll(e: Event): void {
  const checked = (e.target as HTMLInputElement).checked;
  if (checked) store.items.forEach(i => selection.add(i.key));
  else selection = new Set();
  rerender();
}

function openObject(ws: string, bucket: string, key: string): void {
  const url = new URL(location.href);
  url.searchParams.set('object', key);
  history.replaceState(null, '', url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : ''));
  store.inspectorKey = key;
  queueMicrotask(async () => { await loadInspector(ws, bucket, key); });
  rerender();
}

export async function loadBucketView(ws: string, bucket: string, query: URLSearchParams): Promise<void> {
  const params = new URLSearchParams();
  const prefix = query.get('prefix') ?? '';
  if (prefix) params.set('prefix', prefix);
  const tag = query.get('tag_filter') ?? '';
  if (tag) params.set('tag_filter', tag);
  params.set('delimiter', query.get('delimiter') ?? '/');
  const cursor = query.get('cursor');
  if (cursor) params.set('cursor', cursor);
  const bs = await api<{ buckets: Bucket[] }>('GET', `/api/w/${ws}/buckets`);
  store.buckets = bs.data.buckets ?? [];
  if (!bucket) return;
  const r = await api<{ items: ListItem[]; common_prefixes: string[]; next_cursor: string | null; truncated: boolean }>(
    'GET', `/api/w/${ws}/buckets/${bucket}/objects${params.toString() ? '?' + params.toString() : ''}`);
  if (r.status === 422) {
    const errors = (r.data as { errors?: Record<string, string> }).errors ?? {};
    store.resultsStatus = `Filter not accepted: ${errors.prefix ?? errors.tag_filter ?? errors.cursor ?? errors.limit ?? ''}`;
    rerender();
    return;
  }
  if (r.status === 404) {
    store.resultsStatus = "This bucket isn't in your workspace.";
    store.items = [];
    store.commonPrefixes = [];
    rerender();
    return;
  }
  store.items = r.data.items ?? [];
  store.commonPrefixes = r.data.common_prefixes ?? [];
  store.nextCursor = r.data.next_cursor ?? null;
  store.truncated = r.data.truncated ?? false;
  store.resultsStatus = r.data.truncated
    ? 'Showing the matches found so far. Narrow the filter or go to the next page.'
    : '';
  const objectKey = query.get('object');
  if (objectKey) {
    store.inspectorKey = objectKey;
    await loadInspector(ws, bucket, objectKey);
  }
  const suspended = await api('GET', '/api/me');
  void suspended;
  rerender();
}

export async function loadWorkspaceData(path: string): Promise<void> {
  const parts = path.split('/').filter(Boolean);
  const ws = parts[1];
  if (!ws) return;
  const r = await api<{ buckets: Bucket[] }>('GET', `/api/w/${ws}/buckets`);
  store.buckets = r.data.buckets ?? [];
  const regions = await api<{ regions: Array<{ id: string; name: string }> }>('GET', '/api/regions');
  store.regions = regions.data.regions ?? [];
}

// ---------- Inspector ----------

function Inspector(ws: string, bucket: string, role: string): VNode {
  const canWrite = role === 'developer' || role === 'owner';
  const isOwner = role === 'owner';
  const reps = store.inspector.replicas as ReplicaState | null;
  const obj = store.inspector.object as Record<string, unknown> | null;
  const versions = store.inspector.versions as VersionInfo[];
  const key = store.inspectorKey ?? '';
  const placed = reps?.replicas.length ?? 0;
  const settledCount = reps?.replicas.filter(r => r.state === 'settled').length ?? 0;
  const failedCount = reps?.replicas.filter(r => r.state === 'failed').length ?? 0;
  const pendingCount = reps?.replicas.filter(r => r.state === 'pending').length ?? 0;
  const readiness = reps
    ? failedCount > 0
      ? releaseReadiness('failed', placed, shortVersion(reps.version_id), 0, failedCount)
      : reps.ready
        ? releaseReadiness('ready', placed, shortVersion(reps.version_id))
        : releaseReadiness('waiting', placed, shortVersion(reps.version_id), pendingCount)
    : '';
  return (
    <aside class="inspector" role="region" aria-label="Object inspector">
      <div class="close-row"><button onclick={closeInspector}>Close inspector</button></div>
      <h3 id="inspector-key">{key}</h3>
      <p class="meta mono">{reps ? `${shortVersion(reps.version_id)} · ${reps.etag}` : ''}</p>
      {obj ? (
        <p class="meta">
          <span>{fmtInt(Number(obj['size'] ?? 0))} bytes</span>
          <span>{String(obj['content_type'] ?? '')}</span>
          <span>{Object.entries((obj['tags'] as Record<string, string>) ?? {}).map(([k, v]) => `${k}=${v}`).join(', ')}</span>
        </p>
      ) : null}
      <figure class="replica-map" aria-label="Replica map">
        <div class="pins">
          {(reps?.replicas ?? []).map(r => (
            <div key={r.region} class="pin" data-region={r.region}>
              <span class="dot {r.state}" data-state={r.state} />
              <span>{store.regions.find(g => g.id === r.region)?.name ?? r.region}</span>
              <span class="word">{r.role === 'origin' ? 'origin' : r.state}</span>
              {r.state === 'failed' && canWrite ? <button onclick={() => retryReplica(ws, bucket, r.region)}>Retry {store.regions.find(g => g.id === r.region)?.name ?? r.region}</button> : null}
              {r.state === 'settled' && r.role !== 'origin' ? <span class="numeral" data-numeral={r.region}>{fmtInt(r.settle_ms ?? 0)} ms</span> : null}
              {r.state === 'pending' && r.role !== 'origin' ? <span class="numeral" data-numeral={r.region}>0 ms</span> : null}
              {r.role !== 'origin' ? <span class="wakeline" data-wake={r.region} data-progress={r.state === 'settled' ? '1.00' : '0.00'}></span> : null}
            </div>
          ))}
        </div>
      </figure>
      <ul class="visually-hidden" aria-label="Replica status">
        {(reps?.replicas ?? []).map(r => <li key={r.region}>{replicaListLine(store.regions.find(g => g.id === r.region)?.name ?? r.region, r.role, r.state, r.settle_ms)}</li>)}
      </ul>
      <p class="status" role="status" aria-live="polite" data-testid="replica-announcements">{store.replicaAnnouncements}</p>
      <p class="status" data-testid="release-readiness">{readiness}</p>
      <div class="actions">
        <button onclick={() => downloadObject(ws, bucket, key)}>Download</button>
        <button onclick={() => { store.dialog = 'share'; rerender(); }}>Share link</button>
        {canWrite ? <button onclick={() => { store.dialog = 'upload-version'; rerender(); }}>Upload new version</button> : null}
        {canWrite ? <button onclick={() => deleteObject(ws, bucket, key)}>Delete object</button> : null}
      </div>
      <ul class="versions" aria-label="Versions">
        {versions.map(v => (
          <li key={v.version_id}>
            <span>{versionListItem(v)}</span>
            <span class="vrow">
              {canWrite && !v.current ? <button onclick={() => deleteVersion(ws, bucket, key, v.version_id)}>Delete version {shortVersion(v.version_id)}</button> : null}
              {canWrite ? <button onclick={() => { store.dialog = 'retention'; store.dialogData = { ...store.dialogData, retentionVersion: v.version_id }; rerender(); }}>Retention for {shortVersion(v.version_id)}</button> : null}
              {isOwner ? <input type="checkbox" aria-label={`Legal hold on ${shortVersion(v.version_id)}`} checked={v.legal_hold} onchange={() => setLegalHold(ws, bucket, key, v.version_id, v.legal_hold)} /> : null}
            </span>
          </li>
        ))}
      </ul>
      <p class="status" data-testid="version-status">{store.versionsStatus}</p>
    </aside>
  );
}

function closeInspector(): void {
  const url = new URL(location.href);
  url.searchParams.delete('object');
  history.replaceState(null, '', url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : ''));
  store.inspectorKey = null;
  store.inspector = { object: null, replicas: null, versions: [] };
  rerender();
}

let inspectorPoll: ReturnType<typeof setInterval> | null = null;

export async function loadInspector(ws: string, bucket: string, key: string): Promise<void> {
  const objR = await api('GET', `/api/w/${ws}/buckets/${bucket}/object?key=${encodeURIComponent(key)}`);
  const repR = await api<ReplicaState>('GET', `/api/w/${ws}/buckets/${bucket}/object/replicas?key=${encodeURIComponent(key)}`);
  const verR = await api<{ versions: VersionInfo[] }>('GET', `/api/w/${ws}/buckets/${bucket}/object/versions?key=${encodeURIComponent(key)}`);
  if (objR.status === 404) { store.inspectorKey = null; rerender(); return; }
  const previous = store.inspector.replicas;
  store.inspector.object = objR.data as Record<string, unknown>;
  store.inspector.replicas = repR.data;
  store.inspector.versions = verR.data.versions ?? [];
  // Announce settles that arrived while the inspector is open.
  if (previous && repR.status === 200) {
    const before = new Map(previous.replicas.map(r => [r.region, r.state]));
    for (const r of repR.data.replicas) {
      if (r.state === 'settled' && before.get(r.region) === 'pending') {
        store.replicaAnnouncements = `${store.regions.find(g => g.id === r.region)?.name ?? r.region} settled in ${fmtInt(r.settle_ms ?? 0)} ms`;
      } else if (r.state === 'failed' && before.get(r.region) === 'pending') {
        store.replicaAnnouncements = `${store.regions.find(g => g.id === r.region)?.name ?? r.region} failed`;
      }
    }
    if (previous.version_id !== repR.data.version_id) {
      const pendingRegions = repR.data.replicas.filter(r => r.role !== 'origin').length;
      store.replicaAnnouncements = `New version ${shortVersion(repR.data.version_id)}. Copies pending in ${pendingRegions === 1 ? '1 region' : `${pendingRegions} regions`}.`;
    }
  }
  rerender();
  // Poll while any replica of the open version is pending or failed.
  const anyActive = repR.data.replicas?.some(r => r.state === 'pending' || r.state === 'failed');
  if (anyActive && inspectorPoll === null) {
    inspectorPoll = setInterval(async () => {
      if (!store.inspectorKey) { if (inspectorPoll) clearInterval(inspectorPoll); inspectorPoll = null; return; }
      await loadInspector(ws, bucket, store.inspectorKey);
    }, 1000);
  } else if (!anyActive && inspectorPoll) {
    clearInterval(inspectorPoll);
    inspectorPoll = null;
  }
}

async function retryReplica(ws: string, bucket: string, region: string): Promise<void> {
  const key = store.inspectorKey ?? '';
  const r = await api('POST', `/api/w/${ws}/buckets/${bucket}/object/replicas/${region}/retry?key=${encodeURIComponent(key)}`);
  if (r.status === 202) {
    store.replicaAnnouncements = `${store.regions.find(g => g.id === region)?.name ?? region} retrying`;
    await loadInspector(ws, bucket, key);
  }
}

function downloadObject(ws: string, bucket: string, key: string): void {
  window.location.href = `/api/w/${ws}/buckets/${bucket}/object/content?key=${encodeURIComponent(key)}`;
}

async function deleteObject(ws: string, bucket: string, key: string): Promise<void> {
  const r = await api('DELETE', `/api/w/${ws}/buckets/${bucket}/object?key=${encodeURIComponent(key)}`);
  if (r.status === 204) {
    store.inspectorKey = null;
    store.inspector = { object: null, replicas: null, versions: [] };
    await loadBucketView(ws, bucket, new URL(location.href).searchParams);
  }
}

async function deleteVersion(ws: string, bucket: string, key: string, version: string): Promise<void> {
  const short = shortVersion(version);
  store.versionsStatus = `Updating version ${short}…`;
  rerender();
  const r = await api('DELETE', `/api/w/${ws}/buckets/${bucket}/object/version?key=${encodeURIComponent(key)}&version=${encodeURIComponent(version)}`);
  if (r.status === 204) {
    store.versionsStatus = `Version ${short} deleted.`;
  } else {
    const data = r.data as { error?: string; retain_until?: string; legal_hold?: boolean };
    if (data.error === 'object_locked') {
      store.versionsStatus = data.legal_hold
        ? `Version ${short} is on legal hold; it can't be deleted.`
        : `Version ${short} is held until ${fmtTime(data.retain_until ?? '')}; it can't be deleted.`;
    }
  }
  await loadInspector(ws, bucket, key);
  rerender();
}

async function setLegalHold(ws: string, bucket: string, key: string, version: string, current: boolean): Promise<void> {
  const r = await api('PUT', `/api/w/${ws}/buckets/${bucket}/object/legal-hold?key=${encodeURIComponent(key)}&version=${encodeURIComponent(version)}`, { on: !current });
  if (r.status === 403 && (r.data as { error?: string }).error === 'step_up_required') {
    await stepUpThen(async () => setLegalHold(ws, bucket, key, version, current));
    return;
  }
  if (r.status === 200) {
    store.versionsStatus = !current
      ? `Legal hold on for version ${shortVersion(version)}.`
      : `Legal hold off for version ${shortVersion(version)}.`;
  }
  await loadInspector(ws, bucket, key);
  rerender();
}

/** The step-up dialog: confirm, then replay the original action. */
async function stepUpThen(action: () => Promise<void>): Promise<void> {
  store.pendingAction = { kind: 'generic', run: action };
  store.dialog = 'step-up';
  rerender();
}

export async function confirmStepUp(): Promise<void> {
  const code = (document.getElementById('stepup-code') as HTMLInputElement)?.value ?? '';
  store.stepUpAlert = 'Checking code…';
  rerender();
  const r = await api('POST', '/api/me/two-step/confirm', { code });
  if (r.status === 200) {
    store.dialog = null;
    store.stepUpAlert = '';
    const action = store.pendingAction;
    store.pendingAction = null;
    rerender();
    await action?.run();
  } else {
    const errors = (r.data as { errors?: Record<string, string> }).errors ?? {};
    store.stepUpAlert = errors.code ?? "That code didn't work. Use the current code from your app.";
    rerender();
  }
}

// ---------- Uploads and deletes ----------

function startUploadFromFiles(ws: string, bucket: string, files: File[]): void {
  store.dialog = 'upload';
  store.dialogData = { ...store.dialogData, files };
  rerender();
}

async function performUpload(ws: string, bucket: string, fixedKey: string | null, ifMatch: string | null): Promise<void> {
  const files = (store.dialogData['files'] as File[]) ?? [];
  const prefixInput = (document.getElementById('up-prefix') as HTMLInputElement)?.value ?? '';
  const tagsInput = (document.getElementById('up-tags') as HTMLInputElement)?.value ?? '';
  const tags: Record<string, string> = {};
  for (const pair of tagsInput.split(',').map(s => s.trim()).filter(Boolean)) {
    const eq = pair.indexOf('=');
    if (eq > 0) tags[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  for (const file of files) {
    const key = fixedKey ?? (prefixInput + file.name);
    store.uploadStatus = `Uploading ${file.name}: 0 of ${file.size} bytes`;
    rerender();
    const buf = await file.arrayBuffer();
    const idem = 'up-' + Math.random().toString(36).slice(2, 14) + '-' + encodeURIComponent(key);
    const r = await uploadObject(ws, bucket, key, buf, {
      contentType: file.type || 'application/octet-stream',
      idempotencyKey: idem,
      ifMatch: ifMatch ?? undefined,
      tags,
    });
    if (r.status === 201) {
      const reps = (r.data.replicas as Array<{ role: string }>) ?? [];
      const pending = reps.filter(x => x.role !== 'origin').length;
      store.uploadStatus = pending === 0
        ? `Stored ${key} as version ${shortVersion(String(r.data.version_id))}.`
        : `Stored ${key} as version ${shortVersion(String(r.data.version_id))}. Copies pending in ${pending === 1 ? '1 region' : `${pending} regions`}.`;
    } else {
      const err = r.data as { errors?: Record<string, string>; error?: string; message?: string };
      store.uploadStatus = err.errors?.key ?? err.message ?? 'The upload did not succeed.';
    }
    store.uploadProgress = 0;
    rerender();
  }
  store.dialog = null;
  await loadBucketView(ws, bucket, new URL(location.href).searchParams);
  rerender();
}

async function bulkDelete(ws: string, bucket: string): Promise<void> {
  const keys = [...selection];
  store.deleteStatus = `Deleting ${keys.length} objects…`;
  rerender();
  const idem = 'del-' + Math.random().toString(36).slice(2, 14);
  const r = await api<{ batch_id: string | null; undo_until: string | null; results: Array<{ key: string; outcome: string }> }>(
    'POST', `/api/w/${ws}/buckets/${bucket}/objects/delete`, { keys });
  if (r.status === 200) {
    const deleted = r.data.results.filter(x => x.outcome === 'deleted').length;
    const gone = r.data.results.filter(x => x.outcome === 'not_found').length;
    const middle = gone > 0 ? ` ${gone} were already gone.` : '';
    store.deleteStatus = `Deleted ${deleted} objects.${middle}${r.data.undo_until ? ` Undo until ${fmtTime(r.data.undo_until)}.` : ''}`;
    store.deleteResults = r.data.results.map(x => ({ key: x.key, outcome: x.outcome === 'deleted' ? 'deleted' : 'already gone' }));
    store.undoAvailable = Boolean(r.data.batch_id);
    store.dialogData = { ...store.dialogData, batchId: r.data.batch_id };
    selection = new Set();
    await loadBucketView(ws, bucket, new URL(location.href).searchParams);
  }
  rerender();
}

async function undoDelete(ws: string, bucket: string): Promise<void> {
  const batchId = String(store.dialogData['batchId'] ?? '');
  store.deleteStatus = 'Restoring…';
  rerender();
  const r = await api<{ results: Array<{ key: string; outcome: string }> }>('POST', `/api/w/${ws}/batches/${batchId}/undo`);
  if (r.status === 200) {
    const restored = r.data.results.filter(x => x.outcome === 'restored').length;
    let line = `Restored ${restored} objects.`;
    const newer = r.data.results.filter(x => x.outcome === 'newer_version').length;
    if (newer > 0) line += ` ${newer} kept their newer version.`;
    const gone = r.data.results.filter(x => x.outcome === 'gone').length;
    if (gone > 0) line += ` ${gone} were removed for good.`;
    store.deleteStatus = line;
    store.deleteResults = r.data.results.map(x => ({
      key: x.key,
      outcome: x.outcome === 'restored' ? 'restored' : x.outcome === 'newer_version' ? 'kept newer version' : 'removed for good',
    }));
    store.undoAvailable = false;
    await loadBucketView(ws, bucket, new URL(location.href).searchParams);
  } else if (r.status === 410) {
    store.deleteStatus = 'The undo window has closed.';
    store.undoAvailable = false;
  } else if (r.status === 409) {
    store.deleteStatus = 'This delete was already undone.';
    store.undoAvailable = false;
  }
  rerender();
}

async function openLifecycle(ws: string, bucket: string): Promise<void> {
  const r = await api<{ noncurrent_days: number | null; keep_newest_noncurrent: number; abort_multipart_days: number | null }>(
    'GET', `/api/w/${ws}/buckets/${bucket}/lifecycle`);
  if (r.status === 200) {
    store.dialogData = { ...store.dialogData, lifecycle: r.data };
    store.dialog = 'lifecycle';
    rerender();
  }
}

async function saveLifecycle(ws: string, bucket: string): Promise<void> {
  const nd = (document.getElementById('lc-noncurrent') as HTMLInputElement)?.value ?? '';
  const kn = (document.getElementById('lc-keep') as HTMLInputElement)?.value ?? '0';
  const am = (document.getElementById('lc-abort') as HTMLInputElement)?.value ?? '';
  store.lifecycleStatus = 'Saving rules…';
  rerender();
  const body = {
    noncurrent_days: nd === '' ? null : Number(nd),
    keep_newest_noncurrent: Number(kn),
    abort_multipart_days: am === '' ? null : Number(am),
  };
  const r = await api('PUT', `/api/w/${ws}/buckets/${bucket}/lifecycle`, body);
  if (r.status === 200) {
    store.lifecycleStatus = `Lifecycle rules saved for ${bucket}.`;
    store.dialog = null;
  } else {
    store.lifecycleStatus = 'Rules not saved. Fix the highlighted fields.';
  }
  rerender();
}

// ---------- Centre pages ----------

function ShareLinksPage(ws: string): VNode {
  queueMicrotask(async () => {
    const r = await api<{ links: ShareLink[] }>('GET', `/api/w/${ws}/links`);
    store.links = r.data.links ?? [];
    rerender();
  });
  return (
    <div>
      <h2>Share links</h2>
      <table aria-label="Share links">
        <thead><tr><th>Object key</th><th>Version</th><th>Creator</th><th>Expiry (UTC)</th><th>State</th><th></th></tr></thead>
        <tbody>
          {store.links.map(l => (
            <tr key={l.id}>
              <td>{l.key}</td>
              <td class="mono">{l.version_id.slice(0, 8)}</td>
              <td>{l.created_by.slice(0, 8)}</td>
              <td class="num">{fmtTime(l.expires_at)}</td>
              <td>{l.state}</td>
              <td>{l.state === 'active' ? <button onclick={() => revokeLink(ws, l.id)}>Revoke link</button> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function revokeLink(ws: string, id: string): Promise<void> {
  await api('POST', `/api/w/${ws}/links/${id}/revoke`);
  const r = await api<{ links: ShareLink[] }>('GET', `/api/w/${ws}/links`);
  store.links = r.data.links ?? [];
  store.shareStatus = 'Link revoked. It stops working on the next request.';
  rerender();
}

function TeamPage(ws: string): VNode {
  queueMicrotask(async () => {
    const ms = await api<{ members: Member[] }>('GET', `/api/w/${ws}/members`);
    store.members = ms.data.members ?? [];
    const is = await api<{ invites: Invite[] }>('GET', `/api/w/${ws}/invites`);
    store.invites = is.data.invites ?? [];
    rerender();
  });
  return (
    <div>
      <h2>Team</h2>
      <table aria-label="Members">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead>
        <tbody>
          {store.members.map(m => (
            <tr key={m.user_id}>
              <td>{m.name}</td>
              <td>{m.email}</td>
              <td>
                {m.email === store.me?.user.email ? m.role : (
                  <select aria-label={`Role for ${m.name}`} value={m.role} onchange={(e: Event) => changeRole(ws, m.user_id, m.name, (e.target as HTMLSelectElement).value)}>
                    <option value="owner" selected={m.role === 'owner'}>Owner</option>
                    <option value="developer" selected={m.role === 'developer'}>Developer</option>
                    <option value="viewer" selected={m.role === 'viewer'}>Viewer</option>
                  </select>
                )}
              </td>
              <td>{m.email === store.me?.user.email ? null : <button onclick={() => removeMember(ws, m.user_id, m.name)}>Remove {m.name}</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div class="auth-actions">
        <button class="primary" onclick={() => { store.dialog = 'invite'; rerender(); }}>Invite teammate</button>
      </div>
      <table aria-label="Invites">
        <thead><tr><th>Email</th><th>Role</th><th>Expiry (UTC)</th><th>State</th></tr></thead>
        <tbody>
          {store.invites.map(i => (
            <tr key={i.id}><td>{i.email}</td><td>{i.role}</td><td class="num">{fmtTime(i.expires_at)}</td><td>{i.state}</td></tr>
          ))}
        </tbody>
      </table>
      <p class="status" data-testid="invite-status">{store.inviteStatus}</p>
      <p class="status" data-testid="team-status">{store.teamStatus}</p>
    </div>
  );
}

async function changeRole(ws: string, userId: string, name: string, role: string): Promise<void> {
  store.teamStatus = `Updating ${name}…`;
  rerender();
  const r = await api('PATCH', `/api/w/${ws}/members/${userId}`, { role });
  if (r.status === 200) {
    store.teamStatus = `${name} is now ${role === 'owner' ? 'an owner' : role === 'developer' ? 'a developer' : 'a viewer'}.`.replace('an owner', 'an owner');
    const ms = await api<{ members: Member[] }>('GET', `/api/w/${ws}/members`);
    store.members = ms.data.members ?? [];
  } else if ((r.data as { error?: string }).error === 'last_owner') {
    store.teamStatus = 'A workspace needs at least one owner.';
    const ms = await api<{ members: Member[] }>('GET', `/api/w/${ws}/members`);
    store.members = ms.data.members ?? [];
  }
  rerender();
}

async function removeMember(ws: string, userId: string, name: string): Promise<void> {
  store.teamStatus = `Updating ${name}…`;
  rerender();
  const r = await api('DELETE', `/api/w/${ws}/members/${userId}`);
  if (r.status === 204) {
    store.teamStatus = `${name} removed. Their share links were revoked.`;
    const ms = await api<{ members: Member[] }>('GET', `/api/w/${ws}/members`);
    store.members = ms.data.members ?? [];
  } else if ((r.data as { error?: string }).error === 'last_owner') {
    store.teamStatus = 'A workspace needs at least one owner.';
  }
  rerender();
}

let keysPoll: ReturnType<typeof setInterval> | null = null;

function AccessKeysPage(ws: string): VNode {
  queueMicrotask(async () => { await loadKeys(ws); });
  if (keysPoll === null) {
    keysPoll = setInterval(async () => {
      if (!new URL(location.href).pathname.endsWith('access-keys')) { if (keysPoll) clearInterval(keysPoll); keysPoll = null; return; }
      await loadKeys(ws);
      rerender();
    }, 15000);
  }
  return (
    <div>
      <h2>Access keys</h2>
      <div class="auth-actions"><button class="primary" onclick={() => { store.dialog = 'create-key'; rerender(); }}>Create access key</button></div>
      <table aria-label="Access keys">
        <thead><tr><th>Key ID</th><th>Description</th><th>Permission</th><th>Buckets</th><th>Prefix</th><th>Expires (UTC)</th><th>State</th><th>Last used (UTC)</th><th>Previous secret</th><th>Created (UTC)</th><th></th></tr></thead>
        <tbody>
          {store.keys.map(k => (
            <tr key={k.key_id}>
              <td class="mono">{k.key_id}</td>
              <td>{k.description}</td>
              <td>{k.permission}</td>
              <td>{k.buckets === null ? 'All buckets' : k.buckets.join(', ')}</td>
              <td>{k.prefix ?? '—'}</td>
              <td class="num">{k.expires_at ? fmtTime(k.expires_at) : 'never'}</td>
              <td>{k.expired ? 'expired' : k.state}</td>
              <td class="num">{k.last_used_at ? fmtTime(k.last_used_at) : 'never'}</td>
              <td>{k.previous_secret_expires_at ? `Previous secret works until ${fmtTime(k.previous_secret_expires_at)}` : '—'}</td>
              <td class="num">{fmtTime(k.created_at)}</td>
              <td>
                {k.state === 'active' && !k.expired ? <button onclick={() => { store.dialogData = { ...store.dialogData, rotateKey: k.key_id }; rerender(); store.dialog = 'rotate-key'; rerender(); }}>Rotate key</button> : null}
                {k.state === 'active' ? <button onclick={() => disableKey(ws, k.key_id)}>Disable key</button> : null}
                {k.state === 'disabled' ? <button onclick={() => deleteKey(ws, k.key_id)}>Delete key</button> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p class="status" data-testid="key-status">{store.keyStatus}</p>
    </div>
  );
}

async function loadKeys(ws: string): Promise<void> {
  const r = await api<{ keys: AccessKey[] }>('GET', `/api/w/${ws}/keys`);
  store.keys = r.data.keys ?? [];
}

async function disableKey(ws: string, keyId: string): Promise<void> {
  const r = await api('POST', `/api/w/${ws}/keys/${keyId}/disable`);
  if (r.status === 200) store.keyStatus = `Key ${keyId} disabled. Requests signed with it fail from now on.`;
  else store.keyStatus = "That change isn't allowed from the current state.";
  await loadKeys(ws);
  rerender();
}

async function deleteKey(ws: string, keyId: string): Promise<void> {
  const r = await api('DELETE', `/api/w/${ws}/keys/${keyId}`);
  if (r.status === 204) store.keyStatus = `Key ${keyId} deleted.`;
  else if ((r.data as { error?: string }).error === 'invalid_transition') store.keyStatus = 'Disable the key before deleting it.';
  await loadKeys(ws);
  rerender();
}

let usagePoll: ReturnType<typeof setInterval> | null = null;

function UsagePage(ws: string): VNode {
  queueMicrotask(async () => { await loadUsage(ws); });
  if (usagePoll === null) {
    usagePoll = setInterval(async () => {
      if (!new URL(location.href).pathname.endsWith('usage')) { if (usagePoll) clearInterval(usagePoll); usagePoll = null; return; }
      await loadUsage(ws);
      rerender();
    }, 15000);
  }
  const u = store.usage;
  const storagePct = u ? u.percent.storage : 0;
  const egressPct = u ? u.percent.egress : 0;
  return (
    <div>
      <h2>Usage</h2>
      {u ? (
        <div>
          <div class="meter-row">
            <div class="bar"><div style={`width:${Math.min(100, storagePct)}%`}></div></div>
            <div class="meter-text">
              <span class="mono" aria-label="Stored">{fmtInt(u.stored_bytes)} of {fmtInt(u.plan.included_storage_bytes)} bytes ({storagePct.toFixed(1)}%)</span>
            </div>
            <meter aria-label="Stored" min="0" max="100" value={Math.min(100, storagePct)}></meter>
          </div>
          <div class="meter-row">
            <div class="bar"><div style={`width:${Math.min(100, egressPct)}%`}></div></div>
            <div class="meter-text">
              <span class="mono" aria-label="Egress this month">{fmtInt(u.egress_bytes)} of {fmtInt(u.plan.included_egress_bytes)} bytes ({egressPct.toFixed(1)}%)</span>
            </div>
            <meter aria-label="Egress this month" min="0" max="100" value={Math.min(100, egressPct)}></meter>
          </div>
          <p>Reserved for open uploads {fmtInt(u.reserved_bytes)} bytes</p>
          <p>Request units {fmtInt(u.request_units)}</p>
          <p class="status" data-testid="billing-sync">{billingSyncLine(u.billing.state as 'in_sync' | 'pending' | 'delayed', u.billing.confirmed_through)}</p>
          <table aria-label="Usage rows">
            <thead><tr><th>Window start (UTC)</th><th>Window end (UTC)</th><th>Bucket</th><th>Unit</th><th class="num">Amount</th><th>Billing state</th></tr></thead>
            <tbody>
              {store.usageRows.map((row, i) => (
                <tr key={i}>
                  <td class="num">{fmtTime(row.window_start)}</td>
                  <td class="num">{fmtTime(row.window_end)}</td>
                  <td>{row.bucket}</td>
                  <td>{row.unit}</td>
                  <td class="num">{row.amount}</td>
                  <td>{row.billing_state}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div class="auth-actions">
            <button onclick={() => { window.location.href = `/api/w/${ws}/usage/export.csv`; }}>Download CSV</button>
          </div>
        </div>
      ) : <p>Loading usage…</p>}
    </div>
  );
}

async function loadUsage(ws: string): Promise<void> {
  const u = await api<UsageView>('GET', `/api/w/${ws}/usage`);
  if (u.status === 200) store.usage = u.data;
  const rows = await api<{ rows: UsageRow[] }>('GET', `/api/w/${ws}/usage/rows`);
  store.usageRows = rows.data.rows ?? [];
}

function WebhooksPage(ws: string): VNode {
  queueMicrotask(async () => {
    const r = await api<{ endpoints: WebhookEndpoint[] }>('GET', `/api/w/${ws}/webhooks`);
    store.endpoints = r.data.endpoints ?? [];
    rerender();
  });
  return (
    <div>
      <h2>Webhooks</h2>
      <div class="auth-actions"><button class="primary" onclick={() => { store.dialog = 'add-endpoint'; rerender(); }}>Add endpoint</button></div>
      <table aria-label="Webhook endpoints">
        <thead><tr><th>URL</th><th>Events</th><th>Buckets</th><th>Description</th><th>State</th><th>Created (UTC)</th><th></th></tr></thead>
        <tbody>
          {store.endpoints.map(e => (
            <tr key={e.id}>
              <td>{e.url}</td>
              <td>{e.events.join(', ')}</td>
              <td>{e.buckets === null ? 'All buckets' : e.buckets.join(', ')}</td>
              <td>{e.description}</td>
              <td>{e.state}</td>
              <td class="num">{fmtTime(e.created_at)}</td>
              <td>
                {e.state === 'active' ? <button onclick={() => disableEndpoint(ws, e.id)}>Disable endpoint</button> : null}
                {e.state === 'disabled' ? <button onclick={() => enableEndpoint(ws, e.id)}>Enable endpoint</button> : null}
                {e.state === 'disabled' ? <button onclick={() => deleteEndpoint(ws, e.id)}>Delete endpoint</button> : null}
                <a href={`/console/${ws}/deliveries/${e.id}`}>Deliveries for {e.url}</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p class="status" data-testid="webhook-status">{store.webhookStatus}</p>
    </div>
  );
}

async function disableEndpoint(ws: string, id: string): Promise<void> {
  const r = await api('POST', `/api/w/${ws}/webhooks/${id}/disable`);
  if (r.status === 200) store.webhookStatus = 'Endpoint disabled. New events are not queued for it.';
  else store.webhookStatus = "That change isn't allowed from the current state.";
  refreshEndpoints(ws);
}

async function enableEndpoint(ws: string, id: string): Promise<void> {
  const r = await api('POST', `/api/w/${ws}/webhooks/${id}/enable`);
  if (r.status === 200) store.webhookStatus = 'Endpoint enabled.';
  else store.webhookStatus = "That change isn't allowed from the current state.";
  refreshEndpoints(ws);
}

async function deleteEndpoint(ws: string, id: string): Promise<void> {
  const r = await api('DELETE', `/api/w/${ws}/webhooks/${id}`);
  if (r.status === 204) store.webhookStatus = 'Endpoint deleted.';
  else store.webhookStatus = "That change isn't allowed from the current state.";
  refreshEndpoints(ws);
}

async function refreshEndpoints(ws: string): Promise<void> {
  const r = await api<{ endpoints: WebhookEndpoint[] }>('GET', `/api/w/${ws}/webhooks`);
  store.endpoints = r.data.endpoints ?? [];
  rerender();
}

function DeliveriesPage(ws: string, endpointId: string): VNode {
  queueMicrotask(async () => {
    const r = await api<{ deliveries: Delivery[] }>('GET', `/api/w/${ws}/webhooks/${endpointId}/deliveries`);
    store.deliveries = r.data.deliveries ?? [];
    rerender();
  });
  return (
    <div>
      <h2>Deliveries</h2>
      <table aria-label="Deliveries">
        <thead><tr><th class="num">Sequence</th><th>Event type</th><th>State</th><th class="num">Attempts</th><th class="num">Last status</th><th>Last error</th><th>Next attempt (UTC)</th><th>Delivered (UTC)</th><th></th></tr></thead>
        <tbody>
          {store.deliveries.map(d => (
            <tr key={d.id}>
              <td class="num">{fmtInt(d.sequence)}</td>
              <td>{d.event_type}</td>
              <td>{d.state}</td>
              <td class="num">{fmtInt(d.attempts)}</td>
              <td class="num">{d.last_status ?? '—'}</td>
              <td>{d.last_error ?? '—'}</td>
              <td class="num">{d.next_attempt_at ? fmtTime(d.next_attempt_at) : '—'}</td>
              <td class="num">{d.delivered_at ? fmtTime(d.delivered_at) : '—'}</td>
              <td>{d.state === 'dead' ? <button onclick={() => redeliver(ws, endpointId, d.id, d.sequence)}>Redeliver {d.sequence}</button> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p class="status" data-testid="webhook-status">{store.webhookStatus}</p>
    </div>
  );
}

async function redeliver(ws: string, endpointId: string, deliveryId: string, sequence: number): Promise<void> {
  const r = await api('POST', `/api/w/${ws}/webhooks/${endpointId}/deliveries/${deliveryId}/redeliver`);
  if (r.status === 202) store.webhookStatus = `Delivery ${sequence} queued again.`;
  else store.webhookStatus = "That change isn't allowed from the current state.";
  const d = await api<{ deliveries: Delivery[] }>('GET', `/api/w/${ws}/webhooks/${endpointId}/deliveries`);
  store.deliveries = d.data.deliveries ?? [];
  rerender();
}

const AUDIT_ACTIONS = ['session.signed_in','session.sign_in_failed','password.changed','two_step.enabled','two_step.disabled','member.role_changed','member.removed','invite.created','invite.accepted','access_key.created','access_key.rotated','access_key.disabled','access_key.deleted','legal_hold.changed','encryption.rotated','workspace.suspended','workspace.reinstated','permission.denied'];

function SecurityPage(ws: string, query: URLSearchParams): VNode {
  queueMicrotask(async () => {
    const enc = await api<EncryptionView>('GET', `/api/w/${ws}/encryption`);
    store.encryption = enc.data;
    await loadAudit(ws, query);
    rerender();
  });
  const enc = store.encryption;
  return (
    <div>
      <section class="panel" aria-label="Encryption">
        <h3>Encryption</h3>
        <p>{enc ? (enc.rotated_at ? `Workspace key generation ${enc.generation}, rotated ${fmtTime(enc.rotated_at)}.` : `Workspace key generation ${enc.generation}, never rotated.`) : ''}</p>
        <div class="auth-actions"><button class="primary" onclick={() => { store.dialog = 'rotate-key-generation'; rerender(); }}>Rotate workspace key</button></div>
        <p class="status" data-testid="encryption-status">{store.encryptionStatus}</p>
      </section>
      <section class="panel" aria-label="Audit trail">
        <h3>Audit trail</h3>
        <div class="toolbar">
          <select id="audit-action" aria-label="Action" value={query.get('action') ?? ''}>
            <option value="">All actions</option>
            {AUDIT_ACTIONS.map(a => <option key={a} value={a} selected={query.get('action') === a}>{a}</option>)}
          </select>
          <input id="audit-actor" placeholder="Actor" aria-label="Actor" value={query.get('actor') ?? ''} />
          <button onclick={() => applyAuditFilters(ws)}>Apply audit filters</button>
        </div>
        <table aria-label="Audit trail">
          <thead><tr><th class="num">Seq</th><th>Time (UTC)</th><th>Actor</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
          <tbody>
            {store.auditEntries.map(e => (
              <tr key={e.seq}>
                <td class="num">{fmtInt(e.seq)}</td>
                <td class="num">{fmtTime(e.at)}</td>
                <td>{e.actor}</td>
                <td>{e.action}</td>
                <td>{e.target}</td>
                <td>{e.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div class="pager">
          <button onclick={() => auditNewer(ws)}>Newer entries</button>
          <button onclick={() => auditOlder(ws)}>Older entries</button>
          <button onclick={() => verifyChain(ws)}>Verify chain</button>
          <button onclick={() => { window.location.href = `/api/w/${ws}/audit/export.csv`; }}>Download audit CSV</button>
        </div>
        <p class="status" data-testid="audit-status">{store.auditStatus}</p>
      </section>
    </div>
  );
}

async function loadAudit(ws: string, query: URLSearchParams): Promise<void> {
  const params = new URLSearchParams();
  const action = query.get('action');
  const actor = query.get('actor');
  const cursor = query.get('cursor');
  if (action) params.set('action', action);
  if (actor) params.set('actor', actor);
  if (cursor) params.set('cursor', cursor);
  const r = await api<{ entries: AuditEntry[]; next_cursor: string | null }>('GET', `/api/w/${ws}/audit${params.toString() ? '?' + params.toString() : ''}`);
  if (r.status === 200) {
    store.auditEntries = r.data.entries ?? [];
    store.auditNextCursor = r.data.next_cursor ?? null;
  }
}

function applyAuditFilters(ws: string): Promise<void> {
  const action = (document.getElementById('audit-action') as HTMLSelectElement)?.value ?? '';
  const actor = (document.getElementById('audit-actor') as HTMLInputElement)?.value ?? '';
  const url = new URL(location.href);
  url.searchParams.delete('cursor');
  url.searchParams.delete('prev');
  if (action) url.searchParams.set('action', action); else url.searchParams.delete('action');
  if (actor) url.searchParams.set('actor', actor); else url.searchParams.delete('actor');
  history.pushState(null, '', url.pathname + '?' + url.searchParams.toString());
  return loadAudit(ws, url.searchParams).then(() => rerender());
}

function auditNewer(ws: string): void {
  const url = new URL(location.href);
  const prevs = url.searchParams.getAll('prev');
  prevs.pop();
  url.searchParams.delete('prev');
  prevs.forEach(p => url.searchParams.append('prev', p));
  const prevCursor = prevs.length > 0 ? prevs[prevs.length - 1] : null;
  if (prevCursor !== null && prevCursor !== '') url.searchParams.set('cursor', prevCursor); else url.searchParams.delete('cursor');
  history.pushState(null, '', url.pathname + '?' + url.searchParams.toString());
}

function auditOlder(ws: string): void {
  const url = new URL(location.href);
  if (store.auditNextCursor) {
    const prevs = url.searchParams.getAll('prev');
    prevs.push(url.searchParams.get('cursor') ?? '');
    url.searchParams.delete('prev');
    prevs.forEach(p => url.searchParams.append('prev', p));
    url.searchParams.set('cursor', store.auditNextCursor);
  }
  history.pushState(null, '', url.pathname + '?' + url.searchParams.toString());
}

async function verifyChain(ws: string): Promise<void> {
  store.auditStatus = 'Verifying chain…';
  rerender();
  const r = await api<{ ok: boolean; entries: number; first_broken_seq: number | null }>('GET', `/api/w/${ws}/audit/verify`);
  if (r.status === 200) {
    store.auditStatus = r.data.ok
      ? `Chain verified: ${fmtInt(r.data.entries)} entries intact.`
      : `Chain broken at entry ${fmtInt(r.data.first_broken_seq ?? 0)}.`;
  }
  rerender();
}

// ---------- Dialogs ----------

function Dialogs(ws: string, bucket: string, role: string): VNode {
  const d = store.dialog;
  const key = store.inspectorKey ?? '';
  const Back = (children: unknown): VNode => <div class="dialog-backdrop">{children}</div>;
  if (d === 'new-bucket') {
    return Back(
      <div class="dialog-panel" role="dialog" aria-label="New bucket">
        <h3>New bucket</h3>
        <label for="nb-name">Bucket name</label>
        <input id="nb-name" />
        <p class="hint">Lowercase letters, digits and hyphens.</p>
        <label for="nb-origin">Origin region</label>
        <select id="nb-origin" aria-label="Origin region">
          {store.regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <fieldset>
          <legend>Replica regions</legend>
          {store.regions.map(r => (
            <div class="checkbox-row" key={r.id}>
              <input type="checkbox" id={'nb-' + r.id} aria-label={r.name} />
              <label for={'nb-' + r.id}>{r.name}</label>
            </div>
          ))}
        </fieldset>
        <div class="dialog-actions">
          <button class="primary" onclick={() => createBucket(ws)}>Create bucket</button>
          <button onclick={closeDialog}>Cancel</button>
        </div>
      </div>
    );
  }
  if (d === 'upload' || d === 'upload-version') {
    const files = (store.dialogData['files'] as File[]) ?? [];
    const fixedKey = d === 'upload-version' ? key : null;
    return Back(
      <div class="dialog-panel" role="dialog" aria-label="Upload">
        <h3>Upload</h3>
        <ul aria-label="Files to upload">
          {files.map(f => <li key={f.name}>{f.name} · {fmtInt(f.size)} bytes</li>)}
        </ul>
        {fixedKey ? <p class="hint">Key: {fixedKey}</p> : (
          <div><label for="up-prefix">Key prefix</label><input id="up-prefix" /></div>
        )}
        <label for="up-tags">Tags</label>
        <input id="up-tags" placeholder="key=value, separated by commas" />
        {fixedKey ? (
          <div class="checkbox-row">
            <input type="checkbox" id="up-condition" />
            <label for="up-condition">Only overwrite the version I opened</label>
          </div>
        ) : null}
        <div class="dialog-actions">
          <button class="primary" onclick={() => {
            const ifMatch = (document.getElementById('up-condition') as HTMLInputElement)?.checked
              ? String((store.inspector.object as Record<string, unknown>)?.['etag'] ?? '')
              : null;
            performUpload(ws, bucket, fixedKey, ifMatch);
          }}>Start upload</button>
          <button onclick={closeDialog}>Cancel</button>
        </div>
      </div>
    );
  }
  if (d === 'delete-objects') {
    return Back(
      <div class="dialog-panel" role="dialog" aria-label="Delete objects">
        <h3>Delete objects</h3>
        <ul>{[...selection].map(k => <li key={k}>{k}</li>)}</ul>
        <div class="dialog-actions">
          <button class="primary" onclick={() => { store.dialog = null; bulkDelete(ws, bucket); }}>Delete objects</button>
          <button onclick={closeDialog}>Cancel</button>
        </div>
      </div>
    );
  }
  if (d === 'lifecycle') {
    const lc = store.dialogData['lifecycle'] as { noncurrent_days: number | null; keep_newest_noncurrent: number; abort_multipart_days: number | null };
    return Back(
      <div class="dialog-panel" role="dialog" aria-label="Lifecycle rules">
        <h3>Lifecycle rules</h3>
        <label for="lc-noncurrent">Expire noncurrent versions after (days)</label>
        <input id="lc-noncurrent" type="number" value={lc?.noncurrent_days ?? ''} />
        <label for="lc-keep">Keep newest noncurrent versions</label>
        <input id="lc-keep" type="number" value={lc?.keep_newest_noncurrent ?? 0} />
        <label for="lc-abort">Abort incomplete uploads after (days)</label>
        <input id="lc-abort" type="number" value={lc?.abort_multipart_days ?? ''} />
        <div class="dialog-actions">
          <button class="primary" onclick={() => saveLifecycle(ws, bucket)}>Save rules</button>
          <button onclick={closeDialog}>Cancel</button>
        </div>
      </div>
    );
  }
  if (d === 'retention') {
    const version = String(store.dialogData['retentionVersion'] ?? '');
    return Back(
      <div class="dialog-panel" role="dialog" aria-label="Retention">
        <h3>Retention</h3>
        <label for="rt-until">Retain until (UTC)</label>
        <input id="rt-until" value={String(store.dialogData['retentionValue'] ?? '')}
          oninput={(e: Event) => { store.dialogData = { ...store.dialogData, retentionValue: (e.target as HTMLInputElement).value }; }} />
        <div class="dialog-actions">
          <button class="primary" onclick={() => saveRetention(ws, bucket, key, version)}>Save retention</button>
          <button onclick={closeDialog}>Cancel</button>
        </div>
      </div>
    );
  }
  if (d === 'share') {
    const link = store.dialogData['shareLink'] as { url: string } | null;
    return Back(
      <div class="dialog-panel" role="dialog" aria-label="Share link">
        <h3>Share link</h3>
        <label for="sh-expiry">Expires in</label>
        <select id="sh-expiry" aria-label="Expires in" value={String(store.dialogData['shareExpiry'] ?? '1 hour')}
          onchange={(e: Event) => { store.dialogData = { ...store.dialogData, shareExpiry: (e.target as HTMLSelectElement).value }; }}>
          <option value="1 hour">1 hour</option>
          <option value="24 hours">24 hours</option>
          <option value="7 days">7 days</option>
          <option value="Custom">Custom</option>
        </select>
        {store.dialogData['shareExpiry'] === 'Custom' ? (
          <div><label for="sh-seconds">Seconds</label><input id="sh-seconds" type="number" /></div>
        ) : null}
        <div class="dialog-actions">
          <button class="primary" onclick={() => createLink(ws, bucket, key)}>Create link</button>
          <button onclick={closeDialog}>Cancel</button>
        </div>
        {link ? (
          <div>
            <label for="sh-url">Link URL</label>
            <input id="sh-url" readonly value={link.url} />
            <div class="dialog-actions"><button onclick={() => { navigator.clipboard.writeText(link.url); store.shareStatus = 'Link copied.'; rerender(); }}>Copy link</button></div>
          </div>
        ) : null}
        <p class="status" data-testid="share-status">{store.shareStatus}</p>
      </div>
    );
  }
  if (d === 'invite') {
    return Back(
      <div class="dialog-panel" role="dialog" aria-label="Invite teammate">
        <h3>Invite teammate</h3>
        <label for="iv-email">Email</label>
        <input id="iv-email" type="email" />
        <label for="iv-role">Role</label>
        <select id="iv-role" aria-label="Role">
          <option value="developer">Developer</option>
          <option value="viewer">Viewer</option>
        </select>
        <div class="dialog-actions">
          <button class="primary" onclick={() => sendInvite(ws)}>Send invite</button>
          <button onclick={closeDialog}>Cancel</button>
        </div>
        <p class="status" data-testid="invite-status">{store.inviteStatus}</p>
      </div>
    );
  }
  if (d === 'create-key') {
    const created = store.dialogData['createdKey'] as { key_id: string; secret: string } | null;
    return Back(
      <div class="dialog-panel" role="dialog" aria-label="Create access key">
        <h3>Create access key</h3>
        {created ? (
          <div>
            <p>Key {created.key_id} created. Copy the secret now; Farshore won't show it again.</p>
            <label for="ck-secret">Secret access key</label>
            <input id="ck-secret" readonly value={created.secret} />
            <div class="dialog-actions">
              <button onclick={() => { navigator.clipboard.writeText(created.secret); }}>Copy secret</button>
              <button onclick={closeDialog}>Done</button>
            </div>
          </div>
        ) : (
          <div>
            <label for="ck-desc">Description</label>
            <input id="ck-desc" />
            <fieldset><legend>Permission</legend>
              <div class="checkbox-row"><input type="radio" id="ck-read" name="ck-perm" value="read" /><label for="ck-read">Read only</label></div>
              <div class="checkbox-row"><input type="radio" id="ck-write" name="ck-perm" value="read-write" checked /><label for="ck-write">Read and write</label></div>
            </fieldset>
            <fieldset><legend>Buckets</legend>
              <div class="checkbox-row"><input type="checkbox" id="ck-all" checked onchange={(e: Event) => toggleBuckets('ck-all', e)} /><label for="ck-all">All buckets</label></div>
              {store.buckets.map(b => (
                <div class="checkbox-row" key={b.name}><input type="checkbox" class="ck-bucket" id={'ck-' + b.name} /><label for={'ck-' + b.name}>{b.name}</label></div>
              ))}
            </fieldset>
            <label for="ck-prefix">Object prefix</label>
            <input id="ck-prefix" placeholder="(empty means none)" />
            <label for="ck-expires">Expires at (UTC)</label>
            <input id="ck-expires" placeholder="YYYY-MM-DD HH:MM:SS" />
            <div class="dialog-actions">
              <button class="primary" onclick={() => createKey(ws, role)}>Create key</button>
              <button onclick={closeDialog}>Cancel</button>
            </div>
          </div>
        )}
        <p class="status" data-testid="key-status">{store.keyStatus}</p>
      </div>
    );
  }
  if (d === 'rotate-key') {
    const rotated = store.dialogData['rotatedKey'] as { key_id: string; secret: string } | null;
    const keyId = String(store.dialogData['rotateKey'] ?? '');
    return Back(
      <div class="dialog-panel" role="dialog" aria-label="Rotate access key">
        <h3>Rotate access key</h3>
        {rotated ? (
          <div>
            <p>Key {rotated.key_id} rotated. The previous secret keeps working until the overlap ends.</p>
            <label for="rk-secret">New secret access key</label>
            <input id="rk-secret" readonly value={rotated.secret} />
            <div class="dialog-actions">
              <button onclick={() => { navigator.clipboard.writeText(rotated.secret); }}>Copy secret</button>
              <button onclick={closeDialog}>Done</button>
            </div>
          </div>
        ) : (
          <div>
            <p>Rotate {keyId}? The previous secret keeps working until the overlap ends.</p>
            <div class="dialog-actions">
              <button class="primary" onclick={() => rotateKey(ws, keyId, role)}>Rotate</button>
              <button onclick={closeDialog}>Cancel</button>
            </div>
          </div>
        )}
        <p class="status" data-testid="key-status">{store.keyStatus}</p>
      </div>
    );
  }
  if (d === 'add-endpoint') {
    const created = store.dialogData['createdEndpoint'] as { secret: string } | null;
    return Back(
      <div class="dialog-panel" role="dialog" aria-label="Add webhook endpoint">
        <h3>Add webhook endpoint</h3>
        {created ? (
          <div>
            <p>Endpoint added. Copy the signing secret now; Farshore won't show it again.</p>
            <label for="wh-secret">Signing secret</label>
            <input id="wh-secret" readonly value={created.secret} />
            <div class="dialog-actions">
              <button onclick={() => { navigator.clipboard.writeText(created.secret); }}>Copy secret</button>
              <button onclick={closeDialog}>Done</button>
            </div>
          </div>
        ) : (
          <div>
            <label for="wh-url">Endpoint URL</label>
            <input id="wh-url" type="url" />
            <fieldset><legend>Events</legend>
              {['object.created', 'object.deleted', 'object.restored', 'version.removed'].map(ev => (
                <div class="checkbox-row" key={ev}><input type="checkbox" class="wh-event" id={'wh-' + ev} /><label for={'wh-' + ev}>{ev}</label></div>
              ))}
            </fieldset>
            <fieldset><legend>Buckets</legend>
              <div class="checkbox-row"><input type="checkbox" id="wh-all" checked /><label for="wh-all">All buckets</label></div>
              {store.buckets.map(b => (
                <div class="checkbox-row" key={b.name}><input type="checkbox" class="wh-bucket" id={'whb-' + b.name} /><label for={'whb-' + b.name}>{b.name}</label></div>
              ))}
            </fieldset>
            <label for="wh-desc">Description</label>
            <input id="wh-desc" />
            <div class="dialog-actions">
              <button class="primary" onclick={() => createEndpoint(ws)}>Create endpoint</button>
              <button onclick={closeDialog}>Cancel</button>
            </div>
          </div>
        )}
        <p class="status" data-testid="webhook-status">{store.webhookStatus}</p>
      </div>
    );
  }
  if (d === 'rotate-key-generation') {
    return Back(
      <div class="dialog-panel" role="dialog" aria-label="Rotate workspace key">
        <h3>Rotate workspace key</h3>
        <p>Rotate the workspace key? Object bytes stay where they are; only their data keys are re-wrapped.</p>
        <div class="dialog-actions">
          <button class="primary" onclick={() => rotateWorkspaceKey(ws)}>Rotate</button>
          <button onclick={closeDialog}>Cancel</button>
        </div>
        <p class="status" data-testid="encryption-status">{store.encryptionStatus}</p>
      </div>
    );
  }
  if (d === 'step-up') {
    return Back(
      <div class="dialog-panel" role="dialog" aria-label="Confirm it's you">
        <h3>Confirm it's you</h3>
        <p>Enter the current code from your authenticator app to continue.</p>
        <label for="stepup-code">Authenticator code</label>
        <input id="stepup-code" inputmode="numeric" />
        <div class="dialog-actions">
          <button class="primary" onclick={confirmStepUp}>Confirm</button>
          <button onclick={cancelStepUp}>Cancel</button>
        </div>
        <p class="alert" role="alert">{store.stepUpAlert}</p>
      </div>
    );
  }
  return Back(<div></div>);
}

function closeDialog(): void {
  store.dialog = null;
  store.dialogData = { ...store.dialogData, createdKey: null, rotatedKey: null, createdEndpoint: null, shareLink: null };
  rerender();
}

function cancelStepUp(): void {
  store.dialog = null;
  store.pendingAction = null;
  store.keyStatus = copy.stepUpCancelled;
  store.encryptionStatus = copy.stepUpCancelled;
  store.versionsStatus = copy.stepUpCancelled;
  rerender();
}

function toggleBuckets(id: string, e: Event): void {
  const checked = (e.target as HTMLInputElement).checked;
  document.querySelectorAll('.ck-bucket').forEach(el => ((el as HTMLInputElement).disabled = checked));
  void id;
}

async function createBucket(ws: string): Promise<void> {
  const name = (document.getElementById('nb-name') as HTMLInputElement)?.value ?? '';
  const origin = (document.getElementById('nb-origin') as HTMLSelectElement)?.value ?? '';
  const replicas = store.regions
    .filter(r => r.id !== origin && (document.getElementById('nb-' + r.id) as HTMLInputElement)?.checked)
    .map(r => r.id);
  store.bucketStatus = `Creating ${name}…`;
  rerender();
  const r = await api('POST', `/api/w/${ws}/buckets`, { name, placement: [origin, ...replicas] });
  if (r.status === 201) {
    const regionNames = [origin, ...replicas].map(id => store.regions.find(g => g.id === id)?.name ?? id).join(', ');
    store.bucketStatus = `Created ${name} in ${regionNames}.`;
    store.dialog = null;
    await loadWorkspaceData(location.pathname);
    history.pushState(null, '', `/console/${ws}/${name}`);
    rerender();
    setTimeout(() => { document.getElementById('bucket-heading')?.focus(); }, 50);
  } else {
    const err = r.data as { errors?: Record<string, string>; error?: string };
    if (err.errors?.name) store.bucketStatus = "This name doesn't meet the bucket naming rules.";
    else if (err.errors?.placement) store.bucketStatus = 'Choose one origin and up to three other regions.';
    else if (err.error === 'bucket_name_taken') store.bucketStatus = 'That name is taken. Bucket names are unique across all of Farshore.';
    else store.bucketStatus = 'The bucket could not be created.';
    rerender();
  }
}

async function saveRetention(ws: string, bucket: string, key: string, version: string): Promise<void> {
  const value = String(store.dialogData['retentionValue'] ?? '');
  const r = await api('PUT', `/api/w/${ws}/buckets/${bucket}/object/retention?key=${encodeURIComponent(key)}&version=${encodeURIComponent(version)}`,
    { retain_until: value.replace(' ', 'T') + (value.includes('Z') ? '' : 'Z') });
  if (r.status === 200) {
    store.versionsStatus = `Version ${shortVersion(version)} held until ${fmtTime(String((r.data as { retain_until: string }).retain_until))}.`;
    store.dialog = null;
    await loadInspector(ws, bucket, key);
  } else {
    const err = r.data as { errors?: Record<string, string> };
    if ((r.data as { error?: string }).error === 'retention_locked') store.versionsStatus = 'Retention can be extended but not shortened.';
    else store.versionsStatus = err.errors?.retain_until ?? 'The retention could not be saved.';
  }
  rerender();
}

async function createLink(ws: string, bucket: string, key: string): Promise<void> {
  const expiry = String(store.dialogData['shareExpiry'] ?? '1 hour');
  let seconds = 3600;
  if (expiry === '24 hours') seconds = 86_400;
  else if (expiry === '7 days') seconds = 604_800;
  else if (expiry === 'Custom') seconds = Number((document.getElementById('sh-seconds') as HTMLInputElement)?.value ?? '0');
  store.shareStatus = 'Creating link…';
  rerender();
  const r = await api<{ url: string; expires_at: string }>('POST',
    `/api/w/${ws}/buckets/${bucket}/object/links?key=${encodeURIComponent(key)}`, { expires_in_seconds: seconds });
  if (r.status === 201) {
    store.dialogData = { ...store.dialogData, shareLink: { url: r.data.url } };
    store.shareStatus = `Link ready. It expires ${fmtTime(r.data.expires_at)}.`;
  } else {
    store.shareStatus = 'Pick an expiry between one second and seven days.';
  }
  rerender();
}

async function sendInvite(ws: string): Promise<void> {
  const email = (document.getElementById('iv-email') as HTMLInputElement)?.value ?? '';
  const role = (document.getElementById('iv-role') as HTMLSelectElement)?.value ?? 'developer';
  store.inviteStatus = 'Sending invite…';
  rerender();
  const r = await api<{ expires_at: string }>('POST', `/api/w/${ws}/invites`, { email, role });
  if (r.status === 201) {
    store.inviteStatus = `Invite created for ${email}. It expires ${fmtTime(r.data.expires_at)}.`;
    store.dialog = null;
    const is = await api<{ invites: Invite[] }>('GET', `/api/w/${ws}/invites`);
    store.invites = is.data.invites ?? [];
  } else {
    const err = r.data as { errors?: Record<string, string>; error?: string; retry_after_seconds?: number };
    if (err.errors?.email) store.inviteStatus = 'Enter a valid email address.';
    else if (err.error === 'already_member') store.inviteStatus = `${email} is already in this workspace.`;
    else if (err.error === 'rate_limited') store.inviteStatus = `Too many invites right now. Try again in ${err.retry_after_seconds ?? 1} seconds.`;
    else store.inviteStatus = 'The invite could not be created.';
  }
  rerender();
}

async function createKey(ws: string, _role: string): Promise<void> {
  const description = (document.getElementById('ck-desc') as HTMLInputElement)?.value ?? '';
  const permission = (document.querySelector('input[name=ck-perm]:checked') as HTMLInputElement)?.value ?? 'read';
  const allBuckets = (document.getElementById('ck-all') as HTMLInputElement)?.checked ?? true;
  const buckets = allBuckets ? null : Array.from(document.querySelectorAll<HTMLInputElement>('.ck-bucket:checked')).map(el => el.id.slice(3));
  const prefixRaw = (document.getElementById('ck-prefix') as HTMLInputElement)?.value ?? '';
  const expiresRaw = (document.getElementById('ck-expires') as HTMLInputElement)?.value ?? '';
  store.keyStatus = 'Creating key…';
  rerender();
  const r = await api<{ key_id: string; secret: string }>('POST', `/api/w/${ws}/keys`, {
    description, permission, buckets,
    prefix: prefixRaw === '' ? null : prefixRaw,
    expires_at: expiresRaw === '' ? null : expiresRaw.replace(' ', 'T') + 'Z',
  });
  if (r.status === 403 && (r.data as { error?: string }).error === 'step_up_required') {
    await stepUpThen(() => createKey(ws, _role));
    return;
  }
  if (r.status === 201) {
    store.dialogData = { ...store.dialogData, createdKey: { key_id: r.data.key_id, secret: r.data.secret } };
    store.keyStatus = `Key ${r.data.key_id} created. Copy the secret now; Farshore won't show it again.`;
    await loadKeys(ws);
  } else {
    store.keyStatus = 'Key not created. Fix the highlighted fields.';
  }
  rerender();
}

async function rotateKey(ws: string, keyId: string, _role: string): Promise<void> {
  store.keyStatus = 'Rotating key…';
  rerender();
  const r = await api<{ secret: string }>('POST', `/api/w/${ws}/keys/${keyId}/rotate`);
  if (r.status === 403 && (r.data as { error?: string }).error === 'step_up_required') {
    await stepUpThen(() => rotateKey(ws, keyId, _role));
    return;
  }
  if (r.status === 200) {
    store.dialogData = { ...store.dialogData, rotatedKey: { key_id: keyId, secret: r.data.secret } };
    store.keyStatus = `Key ${keyId} rotated. The previous secret works until the overlap ends.`;
    await loadKeys(ws);
  } else if ((r.data as { error?: string }).error === 'rotation_in_progress') {
    store.keyStatus = "This key's previous secret is still live. Rotate again after the overlap ends.";
  } else {
    store.keyStatus = "That change isn't allowed from the current state.";
  }
  rerender();
}

async function createEndpoint(ws: string): Promise<void> {
  const url = (document.getElementById('wh-url') as HTMLInputElement)?.value ?? '';
  const events = Array.from(document.querySelectorAll<HTMLInputElement>('.wh-event:checked')).map(el => el.id.slice(3));
  const allBuckets = (document.getElementById('wh-all') as HTMLInputElement)?.checked ?? true;
  const buckets = allBuckets ? null : Array.from(document.querySelectorAll<HTMLInputElement>('.wh-bucket:checked')).map(el => el.id.slice(4));
  const description = (document.getElementById('wh-desc') as HTMLInputElement)?.value ?? '';
  store.webhookStatus = 'Saving endpoint…';
  rerender();
  const r = await api<{ secret: string }>('POST', `/api/w/${ws}/webhooks`, { url, events, buckets, description });
  if (r.status === 201) {
    store.dialogData = { ...store.dialogData, createdEndpoint: { secret: r.data.secret } };
    store.webhookStatus = 'Endpoint added. Copy the signing secret now; Farshore won\'t show it again.';
    await refreshEndpoints(ws);
  } else if ((r.data as { error?: string }).error === 'endpoint_limit') {
    store.webhookStatus = 'This workspace already has 5 webhook endpoints.';
  } else {
    store.webhookStatus = 'Endpoint not added. Fix the highlighted fields.';
  }
  rerender();
}

async function rotateWorkspaceKey(ws: string): Promise<void> {
  store.encryptionStatus = 'Rotating workspace key…';
  rerender();
  const r = await api<{ generation: number; rewrapped: number }>('POST', `/api/w/${ws}/encryption/rotate`);
  if (r.status === 403 && (r.data as { error?: string }).error === 'step_up_required') {
    await stepUpThen(() => rotateWorkspaceKey(ws));
    return;
  }
  if (r.status === 200) {
    store.encryptionStatus = `Workspace key rotated to generation ${r.data.generation}. ${r.data.rewrapped} data keys re-wrapped.`;
    store.dialog = null;
    const enc = await api<EncryptionView>('GET', `/api/w/${ws}/encryption`);
    store.encryption = enc.data;
  } else if ((r.data as { error?: string }).error === 'rotation_in_progress') {
    store.encryptionStatus = 'Another rotation is running. Try again when it finishes.';
  }
  rerender();
}

export { qs };
