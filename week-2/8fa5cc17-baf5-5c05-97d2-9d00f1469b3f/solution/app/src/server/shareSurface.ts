// The read-only share surface under /s/<token>: no session, the token is the only credential.
import { db } from './db.ts';
import { apiError, HttpError, statusBody, type Json } from './errors.ts';
import { attachmentReply } from './routes/attachments.ts';
import { byTitle } from './routes/objects.ts';
import { linkByToken, linkStatus, scopeOf, writeShareCache, type ShareLinkRow } from './share.ts';
import { getObject, orUnavailable } from './storage.ts';
import { loadSettings } from './workspace.ts';
import { errorReply, isUuid, type Reply } from './http.ts';
import { fieldsOf, loadBlocks, loadObject } from './model.ts';
import { renderBody } from '../shared/richtext.ts';
import { expiresDisplay } from '../shared/time.ts';

export const SHARE_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export const OUTSIDE_QUOTE = 'Quoted from a note outside this share.';

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function link(token: string): Promise<ShareLinkRow> {
  const found = await linkByToken(db, token);
  if (!found) throw statusBody(404, 'unknown');
  return found;
}

/** The collection's errors: unknown token, then an inactive link. */
async function activeLink(token: string): Promise<ShareLinkRow> {
  const found = await link(token);
  const status = linkStatus(found);
  if (status !== 'active') throw statusBody(410, status);
  return found;
}

async function status(token: string): Promise<Json> {
  const found = await link(token);
  const { home_time_zone: zone } = await loadSettings(db);
  return { status: linkStatus(found), expires_at_display: expiresDisplay(found.expires_at.getTime(), zone) };
}

async function collection(token: string): Promise<Json> {
  const found = await activeLink(token);
  const { home_time_zone: zone } = await loadSettings(db);
  const scope = await scopeOf(db, found);
  const [c] = await db.query<{ name: string }>('SELECT name FROM collections WHERE id = $1', [found.collection_id]);
  const objects = byTitle(await db.query<{ id: string; title: string; type_name: string }>(
    `SELECT o.id, o.title, t.name AS type_name FROM objects o JOIN object_types t ON t.id = o.type_id
      WHERE o.id = ANY($1::uuid[])`, [[...scope]]));
  return { status: 'active', collection: { name: c?.name ?? '' }, expires_at_display: expiresDisplay(found.expires_at.getTime(), zone), objects };
}

/** One shared object, filtered by the share scope; its rendering is cached in the store. */
async function sharedObject(token: string, objectId: string): Promise<Json> {
  const found = await activeLink(token);
  const scope = await scopeOf(db, found);
  if (!isUuid(objectId) || !scope.has(objectId)) throw apiError(404, 'not_in_share');
  const o = await loadObject(db, objectId);
  if (!o) throw apiError(404, 'not_in_share');
  const fields = await fieldsOf(db, o.type_id);
  const properties: Record<string, Json> = {};
  for (const f of fields) {
    const value = o.properties[f.name] ?? null;
    if (f.kind !== 'relation') properties[f.name] = value;
    else if (typeof value === 'string' && scope.has(value)) {
      const target = await loadObject(db, value);
      if (target) properties[f.name] = target.title;
    }
  }
  const blocks: Json[] = [];
  const html: string[] = [`<article><h1>${escapeHtml(o.title)}</h1>`];
  const origins: string[] = [];
  for (const b of await loadBlocks(db, objectId)) {
    if (b.kind === 'text') {
      blocks.push({ id: b.id, kind: 'text', position: b.position, body: b.body });
      html.push(`<div class="block">${renderBody(b.body ?? '')}</div>`);
    } else if (b.kind === 'quote') {
      if (b.origin_object_id && scope.has(b.origin_object_id)) {
        blocks.push({ id: b.id, kind: 'quote', position: b.position, body: b.body, origin: { object_id: b.origin_object_id, object_title: b.origin_title } });
        html.push(`<figure><blockquote>${renderBody(b.body ?? '')}</blockquote><figcaption>Quoted from ${escapeHtml(b.origin_title ?? '')}</figcaption></figure>`);
        origins.push(b.origin_object_id);
      } else {
        blocks.push({ kind: 'quote', hidden: true });
        html.push(`<figure><p>${OUTSIDE_QUOTE}</p></figure>`);
      }
    } else {
      blocks.push({ id: b.id, kind: 'attachment', position: b.position, attachment: { id: b.attachment_id, filename: b.filename, content_type: b.content_type, size_bytes: b.size_bytes } });
      html.push(`<figure><figcaption>${escapeHtml(b.filename ?? '')}</figcaption></figure>`);
    }
  }
  html.push('</article>');
  const backlinks = (await db.query<{ from_object_id: string; from_title: string; kind: string }>(
    `SELECT le.from_object_id, o.title AS from_title, le.kind FROM link_edges le JOIN objects o ON o.id = le.from_object_id
      WHERE le.to_object_id = $1 ORDER BY le.created_at DESC, le.id DESC`, [objectId])).filter((b) => scope.has(b.from_object_id));
  writeShareCache(found.id, objectId, html.join(''), origins);
  return { id: o.id, title: o.title, type_name: o.type_name, properties, blocks, backlinks };
}

async function sharedAttachment(token: string, attachmentId: string): Promise<Reply> {
  const found = await activeLink(token);
  const scope = await scopeOf(db, found);
  const [row] = isUuid(attachmentId)
    ? await db.query<{ object_id: string; storage_key: string; content_type: string }>(
      'SELECT object_id, storage_key, content_type FROM attachments WHERE id = $1', [attachmentId])
    : [];
  if (!row || !scope.has(row.object_id)) throw apiError(404, 'not_in_share');
  const bytes = await orUnavailable(() => getObject(row.storage_key));
  if (!bytes) throw apiError(503, 'storage_unavailable');
  return attachmentReply(bytes, row.content_type);
}

/** Answers a share surface request: a reply, 'page' for the HTML shell, or null for no such path. */
export async function shareApi(method: string, path: string): Promise<Reply | 'page' | null> {
  const parts = path.split('/').slice(2).map((p) => decodeURIComponent(p)); // ['', 's', token, ...]
  if (method !== 'GET' && method !== 'HEAD') return errorReply(apiError(405, 'read_only', {}, { Allow: 'GET, HEAD' }));
  const [token, ...rest] = parts;
  if (!token) return null;
  try {
    if (rest.length === 0 || (rest.length === 2 && rest[0] === 'o')) return 'page';
    if (rest[0] !== 'api') return null;
    if (rest.length === 2 && rest[1] === 'status') return { status: 200, body: await status(token) };
    if (rest.length === 2 && rest[1] === 'collection') return { status: 200, body: await collection(token) };
    if (rest.length === 3 && rest[1] === 'objects') return { status: 200, body: await sharedObject(token, rest[2]) };
    if (rest.length === 3 && rest[1] === 'attachments') return await sharedAttachment(token, rest[2]);
    return null;
  } catch (error) {
    if (error instanceof HttpError) return errorReply(error);
    throw error;
  }
}
