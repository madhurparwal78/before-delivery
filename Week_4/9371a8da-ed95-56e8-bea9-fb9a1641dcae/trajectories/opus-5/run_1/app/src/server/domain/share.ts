import { config } from '../config.js';
import { one } from '../db.js';
import { iso, ShareLink } from './shapes.js';

export interface ShareLinkRow {
  project_id: string;
  token: string;
  created_at: Date;
  expires_at: Date;
}

export function shareLinkShape(row: ShareLinkRow, now: Date = new Date()): ShareLink {
  return {
    token: row.token,
    url: `${config.appBaseUrl}/s/${row.token}`,
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    active: now.getTime() < row.expires_at.getTime(),
  };
}

/** A live token: known and before its expiry on the server's UTC clock. */
export async function liveShareProjectId(token: string): Promise<string | null> {
  const row = await one<{ project_id: string }>(
    `select project_id from share_links where token = $1 and expires_at > now()`,
    [token],
  );
  return row === null ? null : row.project_id;
}
