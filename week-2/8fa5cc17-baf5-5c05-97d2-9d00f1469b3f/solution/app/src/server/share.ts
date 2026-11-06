// The share link status and the share scope (single home), and the cached share renderings.
import { db, one, type Db } from './db.ts';
import type { Json } from './errors.ts';
import { iso } from './model.ts';
import { deleteEventually, deletePrefixEventually, putObject } from './storage.ts';
import { expiresDisplay, localMinute } from '../shared/time.ts';

export type ShareStatus = 'active' | 'expired' | 'revoked';

export interface ShareLinkRow {
  id: string; collection_id: string; token: string; expires_at: Date; created_at: Date; revoked_at: Date | null;
}

/** Judged by the server's clock: expired from the stored instant onward. */
export function linkStatus(link: ShareLinkRow, now = Date.now()): ShareStatus {
  if (link.revoked_at) return 'revoked';
  return now >= link.expires_at.getTime() ? 'expired' : 'active';
}

export function shareLinkJson(link: ShareLinkRow, zone: string): Json {
  const expires = link.expires_at.getTime();
  return {
    id: link.id, collection_id: link.collection_id, url: `/s/${link.token}`, status: linkStatus(link),
    expires_at: localMinute(expires, zone), expires_at_display: expiresDisplay(expires, zone),
    expires_at_utc: iso(link.expires_at), time_zone: zone, created_at: iso(link.created_at),
    revoked_at: link.revoked_at ? iso(link.revoked_at) : null,
  };
}

export const SHARE_LINK_SELECT = 'SELECT id, collection_id, token, expires_at, created_at, revoked_at FROM share_links';

/** The same rule as `linkStatus`, as SQL: the link is active on the server's clock. */
export const ACTIVE_LINK_SQL = 'revoked_at IS NULL AND expires_at > now()';

export async function linkByToken(q: Db, token: string): Promise<ShareLinkRow | undefined> {
  return one<ShareLinkRow>(q, `${SHARE_LINK_SELECT} WHERE token = $1`, [token]);
}

/** The share scope: objects in the link's collection whose visibility is `follow`. */
export async function scopeOf(q: Db, link: ShareLinkRow): Promise<Set<string>> {
  const rows = await q.query<{ id: string }>(
    `SELECT o.id FROM objects o JOIN collection_members cm ON cm.object_id = o.id
      WHERE cm.collection_id = $1 AND o.share_visibility = 'follow'`, [link.collection_id]);
  return new Set(rows.map((r) => r.id));
}

const cacheKey = (linkId: string, objectId: string): string => `share-cache/${linkId}/${objectId}.html`;

/** Writes the rendered markup of a served share object page; skipped while storage is down. */
export function writeShareCache(linkId: string, objectId: string, html: string, originObjectIds: string[]): void {
  putObject(cacheKey(linkId, objectId), Buffer.from(html, 'utf8'), 'text/html; charset=utf-8')
    .then(() => db.query(
      `INSERT INTO share_cache (share_link_id, object_id, origin_object_ids) VALUES ($1, $2, $3)
       ON CONFLICT (share_link_id, object_id) DO UPDATE SET origin_object_ids = EXCLUDED.origin_object_ids`,
      [linkId, objectId, originObjectIds]))
    .catch(() => undefined);
}

/** Removes every cached rendering of a link (revoked or regenerated). */
export async function dropLinkCache(linkId: string): Promise<void> {
  await db.query('DELETE FROM share_cache WHERE share_link_id = $1', [linkId]);
  deletePrefixEventually(`share-cache/${linkId}/`);
}

/** Removes an object's own renderings and every rendering that showed its body inside a quote. */
export async function dropObjectCache(objectId: string): Promise<void> {
  const rows = await db.query<{ share_link_id: string; object_id: string }>(
    'DELETE FROM share_cache WHERE object_id = $1 OR $1 = ANY(origin_object_ids) RETURNING share_link_id, object_id', [objectId]);
  deleteEventually(rows.map((r) => cacheKey(r.share_link_id, r.object_id)));
}
