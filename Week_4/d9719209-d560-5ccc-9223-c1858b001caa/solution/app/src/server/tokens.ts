import type { Db } from './db.js';
import { one } from './db.js';
import { newToken, tokenDigest } from './accounts.js';
import { now, secondsFromNow } from './clock.js';

export type TokenKind = 'verify' | 'reset';

/** Issues a single-use link token; any older token of the same kind for the account stops working. */
export async function issueToken(db: Db, userId: string, kind: TokenKind, ttlSeconds: number): Promise<string> {
  const token = newToken();
  await db.query(
    'INSERT INTO email_tokens (user_id, kind, token_hash, created_at, expires_at) VALUES ($1, $2, $3, $4, $5)',
    [userId, kind, tokenDigest(token), now(), secondsFromNow(ttlSeconds)]);
  return token;
}

/** Marks the token used and returns its account, or null when it is unknown, used, expired or superseded. */
export async function consumeToken(db: Db, token: string, kind: TokenKind): Promise<string | null> {
  const row = await one<{ user_id: string }>(db,
    `UPDATE email_tokens t SET consumed_at = $3
     WHERE t.token_hash = $1 AND t.kind = $2 AND t.consumed_at IS NULL AND t.expires_at > $3
       AND NOT EXISTS (SELECT 1 FROM email_tokens newer WHERE newer.user_id = t.user_id AND newer.kind = t.kind AND newer.id > t.id)
     RETURNING t.user_id`,
    [tokenDigest(token), kind, now()]);
  return row?.user_id ?? null;
}
