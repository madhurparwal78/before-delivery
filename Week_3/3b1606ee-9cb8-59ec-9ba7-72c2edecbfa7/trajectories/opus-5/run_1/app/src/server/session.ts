import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { base64urlEncode } from '../shared/scheme.js';
import { serverNow } from './clock.js';
import { pool, type Db } from './db.js';

export const SESSION_COOKIE = 'airfold_session';

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export function readSessionToken(req: IncomingMessage): string | null {
  const header = req.headers.cookie;
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return rest.join('=');
  }
  return null;
}

export async function accountIdForRequest(req: IncomingMessage): Promise<string | null> {
  const token = readSessionToken(req);
  if (token === null || token === '') return null;
  const result = await pool.query<{ account_id: string }>(
    'select account_id from sessions where token_hash = $1',
    [hashToken(token)],
  );
  return result.rows[0]?.account_id ?? null;
}

export async function createSession(db: Db, accountId: string): Promise<string> {
  const token = base64urlEncode(randomBytes(32));
  await db.query(
    'insert into sessions (token_hash, account_id, created_at) values ($1, $2, $3)',
    [hashToken(token), accountId, serverNow()],
  );
  return token;
}

export async function revokeOtherSessions(
  db: Db,
  accountId: string,
  keepToken: string,
): Promise<void> {
  await db.query('delete from sessions where account_id = $1 and token_hash <> $2', [
    accountId,
    hashToken(keepToken),
  ]);
}

export function setSessionCookie(res: ServerResponse, token: string): void {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`,
  );
}
