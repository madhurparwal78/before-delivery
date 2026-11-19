import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { App, AuthUser } from '../http/app.ts';

const COOKIE = 'loz_session';

export const authSchema = [
  `CREATE TABLE IF NOT EXISTS users (
     id text PRIMARY KEY,
     username text NOT NULL UNIQUE,
     password_hash text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token_hash text PRIMARY KEY,
     user_id text NOT NULL REFERENCES users(id),
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
];

function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function cookieValue(req: IncomingMessage): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return rest.join('=');
  }
  return null;
}

/** The signed-in user of a request, or null. */
export async function userOf(app: App, req: IncomingMessage): Promise<AuthUser | null> {
  const token = cookieValue(req);
  if (!token) return null;
  return app.db.row<AuthUser>(
    `SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1`,
    [digest(token)],
  );
}

/** Starts a session and returns the `Set-Cookie` header value. */
export async function startSession(app: App, userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await app.db.exec(`INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)`, [digest(token), userId]);
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

/** Ends the request's session (if any) and returns the cookie-clearing `Set-Cookie` value. */
export async function endSession(app: App, req: IncomingMessage): Promise<string> {
  const token = cookieValue(req);
  if (token) await app.db.exec(`DELETE FROM sessions WHERE token_hash = $1`, [digest(token)]);
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
