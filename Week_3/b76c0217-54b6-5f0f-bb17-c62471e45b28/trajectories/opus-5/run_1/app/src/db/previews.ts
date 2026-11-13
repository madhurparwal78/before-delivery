import { newId, newToken } from './ids';
import { db } from './pool';

export interface PreviewLink {
  id: string;
  pageId: string;
  token: string;
  expiresAt: Date;
  revoked: boolean;
}

interface Row {
  id: string;
  page_id: string;
  token: string;
  expires_at: Date;
  revoked: boolean;
}

const toLink = (row: Row): PreviewLink => ({
  id: row.id,
  pageId: row.page_id,
  token: row.token,
  expiresAt: row.expires_at,
  revoked: row.revoked,
});

export async function createPreviewLink(pageId: string, ttlMs: number): Promise<PreviewLink> {
  const { rows } = await db.query<Row>(
    `INSERT INTO preview_links (id, page_id, token, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' milliseconds')::interval) RETURNING *`,
    [newId('previewLink'), pageId, newToken(), String(ttlMs)],
  );
  return toLink(rows[0]);
}

export async function previewLinksOfPage(pageId: string): Promise<PreviewLink[]> {
  const { rows } = await db.query<Row>(
    'SELECT * FROM preview_links WHERE page_id = $1 ORDER BY created_at',
    [pageId],
  );
  return rows.map(toLink);
}

export async function previewLinkById(id: string): Promise<PreviewLink | null> {
  const { rows } = await db.query<Row>('SELECT * FROM preview_links WHERE id = $1', [id]);
  return rows[0] === undefined ? null : toLink(rows[0]);
}

export async function previewLinkByToken(token: string): Promise<PreviewLink | null> {
  const { rows } = await db.query<Row>('SELECT * FROM preview_links WHERE token = $1', [token]);
  return rows[0] === undefined ? null : toLink(rows[0]);
}

export async function revokePreviewLink(id: string): Promise<void> {
  await db.query('UPDATE preview_links SET revoked = true WHERE id = $1', [id]);
}

/** A page is in_preview while a live shared link points at it. */
export async function hasLivePreviewLink(pageId: string): Promise<boolean> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM preview_links
     WHERE page_id = $1 AND revoked = false AND expires_at > now()`,
    [pageId],
  );
  return Number(rows[0].count) > 0;
}
