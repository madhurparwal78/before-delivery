import type { Queryable } from '../db.js';
import { takeLock } from '../db.js';
import { config } from '../config.js';
import { plusSeconds } from '../clock.js';
import { randomToken } from './accounts.js';

export type TokenKind = 'verify' | 'reset';

function lifetimeSeconds(kind: TokenKind): number {
  return kind === 'verify' ? config.verifyTokenSeconds : config.resetTokenSeconds;
}

export async function issueToken(
  client: Queryable,
  accountId: number,
  kind: TokenKind,
  at: Date
): Promise<string> {
  await takeLock(client, 'account', accountId);
  await client.query(
    `UPDATE auth_tokens SET superseded = true
      WHERE account_id = $1 AND kind = $2 AND consumed = false AND superseded = false`,
    [accountId, kind]
  );
  const token = randomToken();
  await client.query(
    `INSERT INTO auth_tokens (account_id, kind, token, issued_at, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      accountId,
      kind,
      token,
      at.toISOString(),
      plusSeconds(at, lifetimeSeconds(kind)).toISOString()
    ]
  );
  return token;
}

export async function consumeToken(
  client: Queryable,
  token: string,
  kind: TokenKind,
  at: Date
): Promise<number | null> {
  const { rows } = await client.query<{ id: number; account_id: number }>(
    `SELECT id, account_id FROM auth_tokens
      WHERE token = $1 AND kind = $2 AND consumed = false AND superseded = false AND expires_at > $3
      FOR UPDATE`,
    [token, kind, at.toISOString()]
  );
  const row = rows[0];
  if (!row) return null;
  await client.query('UPDATE auth_tokens SET consumed = true WHERE id = $1', [row.id]);
  return Number(row.account_id);
}
