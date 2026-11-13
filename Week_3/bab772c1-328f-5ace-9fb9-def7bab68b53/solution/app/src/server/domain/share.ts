/** Share links: unguessable tokens and the one share-link state check. */

import { randomBytes } from "node:crypto";
import type { Queryable } from "../db/pool.js";

export const DEFAULT_EXPIRY_SECONDS = 2_592_000;
export const MAX_EXPIRY_SECONDS = 31_536_000;

export function shareUrlPath(token: string): string {
  return `/s/${token}`;
}

export function newShareToken(): string {
  return randomBytes(32).toString("base64url");
}

export type ShareLinkRow = {
  id: string;
  mission_id: string;
  token: string;
  created_ms: number;
  expires_ms: number;
  revoked: boolean;
};

type ShareLinkState = "active" | "revoked" | "expired";

export async function findShareLink(
  query: Queryable,
  token: string,
): Promise<ShareLinkRow | null> {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(token)) {
    return null;
  }
  const result = await query.query<ShareLinkRow>(
    "select id, mission_id, token, created_ms, expires_ms, revoked from share_links where token = $1",
    [token],
  );
  return result.rows[0] ?? null;
}

/** Revocation takes precedence over expiry; both states are terminal. */
export function shareLinkState(row: ShareLinkRow, nowMs: number): ShareLinkState {
  if (row.revoked) {
    return "revoked";
  }
  return nowMs >= row.expires_ms ? "expired" : "active";
}
