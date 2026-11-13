import { randomBytes } from 'node:crypto';
import { query, transaction } from '../db.js';
import { fail } from '../errors.js';
import { type LinkKind, sendLinkMail } from './mail.js';

/** Link lifetime, measured on this server process's own clock. */
export const LINK_LIFETIME_MS = 30 * 60 * 1000;

/**
 * Issues a link token, invalidating every earlier unused link of the same kind.
 * Locking the account row serialises concurrent issuance across server processes.
 */
async function issueToken(userId: number, kind: LinkKind): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await transaction(async (tx) => {
    await tx.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    await tx.query(
      `UPDATE link_tokens SET invalidated = true
       WHERE user_id = $1 AND kind = $2 AND NOT used AND NOT invalidated`,
      [userId, kind],
    );
    await tx.query(
      `INSERT INTO link_tokens (token, user_id, kind, sent_at_ms) VALUES ($1, $2, $3, $4)`,
      [token, userId, kind, Date.now()],
    );
  });
  return token;
}

/** Issues a link and mails it. A token whose send failed is left unusable. */
export async function issueAndSendLink(
  userId: number,
  email: string,
  kind: LinkKind,
): Promise<boolean> {
  const token = await issueToken(userId, kind);
  const sent = await sendLinkMail(kind, email, token);
  if (!sent) {
    await query('UPDATE link_tokens SET invalidated = true WHERE token = $1', [token]);
  }
  return sent;
}

interface LinkRow {
  user_id: number;
  sent_at_ms: string;
  used: boolean;
  invalidated: boolean;
}

/** Spends a single-use link, or raises the expired or invalid link error. */
export async function consumeLink(token: string, kind: LinkKind): Promise<number> {
  return transaction(async (tx) => {
    const row = await tx.queryOne<LinkRow>(
      `SELECT user_id, sent_at_ms, used, invalidated FROM link_tokens
       WHERE token = $1 AND kind = $2 FOR UPDATE`,
      [token, kind],
    );
    if (row === null || row.used || row.invalidated) throw fail.linkInvalid();
    if (Date.now() - Number(row.sent_at_ms) > LINK_LIFETIME_MS) throw fail.linkExpired();
    await tx.query('UPDATE link_tokens SET used = true WHERE token = $1', [token]);
    return row.user_id;
  });
}
