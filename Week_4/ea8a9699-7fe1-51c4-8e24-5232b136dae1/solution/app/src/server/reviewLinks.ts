// Review link state (brief: Business rules > Review links). The server clock decides expiry to the millisecond.
import { tokenHash } from "./access.js";
import { one, type Db } from "./db.js";

import type { LinkState } from "../shared/api.js";

export type { LinkState };

export interface LinkRow {
  id: string;
  cluster_id: string;
  email: string;
  expires_at: Date;
  can_comment: boolean;
  revoked_at: Date | null;
  inactive_at: Date | null;
}

export const LINK_COLUMNS = "l.id, l.cluster_id, l.email, l.expires_at, l.can_comment, l.revoked_at, l.inactive_at";

export function linkState(link: LinkRow, now: Date): LinkState {
  if (link.revoked_at) return "revoked";
  if (link.inactive_at) return "inactive";
  return now.getTime() < link.expires_at.getTime() ? "live" : "expired";
}

export const GONE: Record<Exclude<LinkState, "live">, "link_expired" | "link_revoked" | "link_inactive"> = {
  expired: "link_expired",
  revoked: "link_revoked",
  inactive: "link_inactive",
};

/** The link a token opens, with its state; a token retired by a regenerate reads as revoked. Null when unknown. */
export async function linkForToken(db: Db, token: string, now: Date): Promise<{ link: LinkRow; state: LinkState } | null> {
  const hash = tokenHash(token);
  const current = await one<LinkRow>(db, `SELECT ${LINK_COLUMNS} FROM review_links l WHERE l.token_hash = $1`, [hash]);
  if (current) return { link: current, state: linkState(current, now) };
  const retired = await one<LinkRow>(
    db,
    `SELECT ${LINK_COLUMNS} FROM retired_review_tokens t JOIN review_links l ON l.id = t.link_id WHERE t.token_hash = $1`,
    [hash],
  );
  return retired ? { link: retired, state: "revoked" } : null;
}
