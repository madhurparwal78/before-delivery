// Publishing: snapshots written once, served unchanged; idempotency keys.
import { db } from './db.js';
import { makeS3Call, snapshotKey, assetKey, imageKey, isStorageUnavailable } from './s3.js';
import { HttpError, conflictError, notFound, invalid } from './errors.js';
import { newId } from './ids.js';
import { getWorkspace, memberRole } from './workspace.js';
import { renderPublishedPage } from './render.js';
import { getImage } from './images.js';
import { config } from './config.js';
import { escapeHtml, type WorkspaceDocument, type DocumentNode } from '../shared/domain.js';

export interface PublishStatus {
  state: 'not_published' | 'live' | 'live_changed' | 'unpublished';
  publishId: string | null;
  publishedSeq: number | null;
  url: string | null;
}

export async function publishStatus(pageId: string): Promise<PublishStatus> {
  const res = await db.query<{ id: string; state: string; seq: string; ws_slug: string; page_slug: string }>(
    `SELECT p.id, p.state, p.seq, w.slug AS ws_slug, pp.slug AS page_slug
     FROM publishes p
     JOIN published_pages pp ON pp.id = p.page_id
     JOIN workspaces w ON w.id = p.workspace_id
     WHERE p.page_id = $1
     ORDER BY p.created_at DESC LIMIT 1`, [pageId]);
  const row = res.rows[0];
  if (!row) return { state: 'not_published', publishId: null, publishedSeq: null, url: null };
  if (row.state === 'live' || row.state === 'live_changed') {
    return {
      state: row.state as 'live' | 'live_changed',
      publishId: row.id,
      publishedSeq: Number(row.seq),
      url: `${config.publicUrl}/p/${row.ws_slug}/${row.page_slug}`,
    };
  }
  return { state: 'unpublished', publishId: null, publishedSeq: null, url: null };
}

/** Pages table keeps page slug/workspace linkage denormalised for the public route. */
export async function ensurePagesTable(workspaceId: string, doc: WorkspaceDocument): Promise<void> {
  for (const page of doc.pages) {
    await db.query(
      'INSERT INTO published_pages (id, workspace_id, slug, name) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name',
      [page.id, workspaceId, page.slug, page.name]);
  }
  // drop rows for pages that no longer exist in the document
  await db.query(
    `DELETE FROM published_pages WHERE workspace_id = $1 AND id <> ALL($2::text[])`,
    [workspaceId, doc.pages.map((p) => p.id)],
  );
}

export async function pageMeta(pageId: string): Promise<{ workspaceId: string; slug: string; name: string } | null> {
  const res = await db.query<{ workspace_id: string; slug: string; name: string }>(
    'SELECT workspace_id, slug, name FROM published_pages WHERE id = $1', [pageId]);
  const row = res.rows[0];
  if (!row) return null;
  return { workspaceId: row.workspace_id, slug: row.slug, name: row.name };
}

const inProgress = new Set<string>();

export async function publishPage(workspaceId: string, pageId: string, idempotencyKey: string | undefined, authorId: string, authorName: string): Promise<PublishStatus> {
  if (inProgress.has(pageId)) throw conflictError('publish_in_progress', 'A publish is already running.');
  inProgress.add(pageId);
  try {
    if (idempotencyKey !== undefined) {
      if (idempotencyKey.length < 1 || idempotencyKey.length > 64) {
        throw invalid({ 'Idempotency-Key': 'Idempotency keys are 1 to 64 characters.' });
      }
      const res = await db.query<{ page_id: string; response: unknown }>(
        'SELECT page_id, response FROM publish_keys WHERE key = $1', [idempotencyKey]);
      const existing = res.rows[0];
      if (existing) {
        if (existing.page_id !== pageId) throw invalid({ 'Idempotency-Key': 'That idempotency key was used for another page.' });
        return JSON.parse(JSON.stringify(existing.response)) as PublishStatus;
      }
    }

    const ws = await getWorkspace(workspaceId);
    if (!ws) throw notFound();
    const page = ws.document.pages.find((p) => p.id === pageId);
    if (!page) throw notFound();
    await ensurePagesTable(workspaceId, ws.document);

    const publishId = newId('pub');
    const call = makeS3Call(workspaceId);
    const rendered = renderPublishedPage(ws.document, page);
    const html = rendered.html.replace('__PLINTH_PUBLISHED_CSS__', publishedCss());
    try {
      await call('PUT', `/${snapshotKey(pageId, publishId)}`, Buffer.from(html, 'utf8'), { 'content-type': 'text/html; charset=utf-8' });
      // copy referenced images
      const imageIds = collectImageIds(ws.document, page);
      for (const imageId of imageIds) {
        const rec = await getImage(imageId);
        if (!rec || rec.workspace_id !== workspaceId) continue;
        const bytes = await call('GET', `/${imageKey(workspaceId, imageId)}`, null, {});
        await call('PUT', `/${assetKey(pageId, publishId, imageId)}`, bytes.body, { 'content-type': rec.content_type });
      }
      // read the snapshot back
      const back = await call('GET', `/${snapshotKey(pageId, publishId)}`, null, {});
      if (back.body.toString('utf8') !== html) throw new Error('snapshot read-back mismatch');
    } catch (err) {
      if (isStorageUnavailable(err)) {
        throw new HttpError(503, { code: 'storage_unavailable' });
      }
      throw err;
    }

    const status: PublishStatus = {
      state: 'live', publishId, publishedSeq: ws.document.seq,
      url: `${config.publicUrl}/p/${ws.document.slug}/${page.slug}`,
    };
    await db.query(
      'INSERT INTO publishes (id, page_id, workspace_id, seq, state) VALUES ($1,$2,$3,$4,\'live\')',
      [publishId, pageId, workspaceId, ws.document.seq]);
    if (idempotencyKey !== undefined) {
      await db.query('INSERT INTO publish_keys (key, page_id, response) VALUES ($1,$2,$3)',
        [idempotencyKey, pageId, JSON.stringify(status)]);
    }
    return status;
  } finally {
    inProgress.delete(pageId);
  }
}

export function collectImageIds(doc: WorkspaceDocument, page: import('../shared/domain.js').Page): string[] {
  const out = new Set<string>();
  const visit = (node: DocumentNode) => {
    if (node.type === 'image' && typeof node.props.imageId === 'string' && node.props.imageId) out.add(node.props.imageId);
    const boundImage = node.bind?.imageId;
    if (node.type === 'image' && boundImage) {
      for (const e of doc.collection.entries) {
        const v = e.values[boundImage];
        if (v) out.add(v);
      }
    }
    for (const c of node.children) visit(c);
  };
  visit(page.root);
  return [...out];
}

export async function unpublishPage(pageId: string): Promise<PublishStatus> {
  const current = await publishStatus(pageId);
  if (current.state !== 'live' && current.state !== 'live_changed') {
    throw conflictError('not_live', 'This page is not live.');
  }
  await db.query('UPDATE publishes SET state = \'unpublished\' WHERE page_id = $1 AND state IN (\'live\',\'live_changed\')', [pageId]);
  return { state: 'unpublished', publishId: null, publishedSeq: null, url: null };
}

/** Snapshot cache: bytes the server has written or served since start, so the
 * public address keeps serving through a storage outage (DP-35). */
const snapshotCache = new Map<string, { html: string; at: number }>();
const assetCache = new Map<string, { bytes: Buffer; contentType: string }>();

export function cacheSnapshot(key: string, html: string): void {
  snapshotCache.set(key, { html, at: Date.now() });
}
export function cacheAsset(key: string, bytes: Buffer, contentType: string): void {
  assetCache.set(key, { bytes, contentType });
}

export async function serveSnapshot(pageId: string, publishId: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  const key = snapshotKey(pageId, publishId);
  const cached = snapshotCache.get(key);
  if (cached) return { bytes: Buffer.from(cached.html, 'utf8'), contentType: 'text/html; charset=utf-8' };
  const meta = await pageMeta(pageId);
  if (!meta) return null;
  const call = makeS3Call(meta.workspaceId);
  const res = await call('GET', `/${key}`, null, {});
  if (res.status === 404 || res.body.length === 0) return null;
  cacheSnapshot(key, res.body.toString('utf8'));
  return { bytes: res.body, contentType: 'text/html; charset=utf-8' };
}

export async function serveAsset(pageId: string, publishId: string, imageId: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  const key = assetKey(pageId, publishId, imageId);
  const cached = assetCache.get(key);
  if (cached) return cached;
  const meta = await pageMeta(pageId);
  if (!meta) return null;
  const call = makeS3Call(meta.workspaceId);
  const res = await call('GET', `/${key}`, null, {});
  if (res.status === 404 || res.body.length === 0) return null;
  const rec = await getImage(imageId);
  const out = { bytes: res.body, contentType: rec?.content_type ?? 'application/octet-stream' };
  cacheAsset(key, out.bytes, out.contentType);
  return out;
}

export function publishedCss(): string {
  return `
html{background:#f4f0e8;}
body{margin:0;font-family:'IBM Plex Sans',sans-serif;color:#1c1917;}
.pl-skip{position:absolute;left:-9999px;}
.pl-skip:focus{position:static;}
main{max-width:100%;}
img{max-width:100%;overflow-wrap:anywhere;}
p,h1,h2,h3,section,div,nav,ul,li{overflow-wrap:anywhere;box-sizing:border-box;}
.pl-rich p{margin:0;}
.pl-empty{list-style:none;}
.pl-nav a{padding:8px;}
@media (max-width:767.98px){
  .pl-nav a,.pl-button{min-height:44px;min-width:44px;display:inline-flex;align-items:center;}
  .pl-nav{flex-wrap:wrap;}
}
.pl-menu-button{display:none;}
@media (max-width:767.98px){
  .pl-menu-button{display:inline-block;}
  .pl-nav[data-collapsed="true"] .pl-navlinks{display:none;}
}
@media (min-width:768px){
  .pl-menu-button{display:none;}
}
`;
}
