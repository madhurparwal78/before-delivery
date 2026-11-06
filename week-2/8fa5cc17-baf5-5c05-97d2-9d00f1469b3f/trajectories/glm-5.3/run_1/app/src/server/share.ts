// The share link state machine and the share scope. The single home of both.

import type { Pool, PoolClient } from "pg";
import { randomBytes } from "node:crypto";

export type ShareStatus = "active" | "expired" | "revoked";

export interface ShareLinkRow {
  id: string;
  collection_id: string;
  token: string;
  expires_at: Date;
  status: string; // 'active' | 'revoked' as stored
  created_at: Date;
  revoked_at: Date | null;
}

/** The status of a link, decided by the server's clock on every response. */
export function shareStatus(row: { expires_at: Date; status: string }): ShareStatus {
  if (row.status === "revoked") return "revoked";
  return row.expires_at.getTime() <= Date.now() ? "expired" : "active";
}

export async function loadShareLink(pool: Pool, id: string): Promise<ShareLinkRow | null> {
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id)) return null;
  const res = await pool.query<ShareLinkRow>(
    "SELECT id, collection_id, token, expires_at, status, created_at, revoked_at FROM share_links WHERE id = $1",
    [id]
  );
  return res.rows[0] ?? null;
}

export async function loadShareLinkByToken(pool: Pool, token: string): Promise<ShareLinkRow | null> {
  const res = await pool.query<ShareLinkRow>(
    "SELECT id, collection_id, token, expires_at, status, created_at, revoked_at FROM share_links WHERE token = $1",
    [token]
  );
  return res.rows[0] ?? null;
}

export function newShareToken(): string {
  return randomBytes(16).toString("base64url");
}

/** The share scope: the collection's objects with share_visibility = follow. */
export async function shareScopeIds(pool: Pool, collectionId: string): Promise<Set<string>> {
  const res = await pool.query<{ object_id: string }>(
    `SELECT m.object_id FROM collection_members m
     JOIN objects o ON o.id = m.object_id
     WHERE m.collection_id = $1 AND o.share_visibility = 'follow'`,
    [collectionId]
  );
  return new Set(res.rows.map((r) => r.object_id));
}

export async function scopeOfLink(pool: Pool, link: ShareLinkRow): Promise<Set<string> | null> {
  const status = shareStatus(link);
  if (status !== "active") return null;
  return shareScopeIds(pool, link.collection_id);
}
