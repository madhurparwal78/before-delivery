import type { Db } from './db';
import { errors } from './httpTypes';
import type { Role } from '../shared/domain';
import { createHash, randomBytes } from 'node:crypto';
import type { Tx } from './db';

export interface SessionInfo {
  token: string;
  userId: string;
  displayName: string;
  email: string;
  walkthroughDone: boolean;
}

const IDLE_SECONDS = Number(process.env.SESSION_IDLE_SECONDS ?? '1800');

export async function createAuthSession(db: Db, userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await db.query(
    `INSERT INTO sessions_auth (token, user_id, last_seen) VALUES ($1,$2,now())`,
    [token, userId],
  );
  return token;
}

export async function readAuthSession(db: Db, token: string | null): Promise<SessionInfo | null> {
  if (!token) return null;
  const res = await db.query(
    `SELECT s.token, s.last_seen, u.id, u.email, u.display_name, u.walkthrough_done
     FROM sessions_auth s JOIN app_users u ON u.id = s.user_id
     WHERE s.token = $1`,
    [token],
  );
  const row = res.rows[0];
  if (!row) return null;
  const lastSeen = new Date(row.last_seen as string).getTime();
  if (Date.now() - lastSeen > IDLE_SECONDS * 1000) {
    await db.query('DELETE FROM sessions_auth WHERE token = $1', [token]);
    return null;
  }
  await db.query('UPDATE sessions_auth SET last_seen = now() WHERE token = $1', [token]);
  return {
    token: row.token,
    userId: row.id,
    email: row.email,
    displayName: row.display_name,
    walkthroughDone: row.walkthrough_done,
  };
}

export async function destroyAuthSession(db: Db, token: string | null): Promise<void> {
  if (!token) return;
  await db.query('DELETE FROM sessions_auth WHERE token = $1', [token]);
}

/** Role of the user in a workspace; the founder belongs to every workspace. */
export async function roleIn(db: Db, workspaceId: string, userId: string): Promise<Role | null> {
  const member = await db.query(
    `SELECT m.role FROM memberships m WHERE m.workspace_id = $1 AND m.user_id = $2`,
    [workspaceId, userId],
  );
  const memberRow = member.rows[0];
  if (memberRow) return memberRow.role as Role;
  const founder = await db.query(
    `SELECT 1 FROM memberships m2 WHERE m2.user_id = $1 AND m2.role = 'founder' LIMIT 1`,
    [userId],
  );
  if ((founder.rowCount ?? 0) > 0) return 'founder';
  return null;
}

export async function workspaceExists(db: Db, workspaceId: string): Promise<boolean> {
  const res = await db.query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
  return (res.rowCount ?? 0) > 0;
}

export function cookieFromToken(token: string): string {
  return `gandyboard_session=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export function tokenFromCookie(header: string | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === 'gandyboard_session') return rest.join('=');
  }
  return null;
}

export function hashBody(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

/**
 * Idempotency: the first request's status and body are stored for the life of
 * the workspace and returned for any later request with the same key and body.
 * A second arrival while the first is running waits for the first result.
 */
export interface IdempotentResult {
  replayed: boolean;
  status: number;
  body: unknown;
}

export async function withIdempotency(
  db: Db,
  workspaceId: string,
  userId: string,
  key: string,
  bodyHash: string,
  fn: (store: (status: number, body: unknown) => Promise<void>) => Promise<{ status: number; body: unknown }>,
): Promise<IdempotentResult> {
  return db.connect().then(async (client) => {
    try {
      // Fast path: a done record returns the stored result.
      const existing = await client.query(
        `SELECT status, response_body, body_hash, done FROM idempotency
         WHERE workspace_id = $1 AND user_id = $2 AND key = $3`,
        [workspaceId, userId, key],
      );
      const row = existing.rows[0];
      if (row) {
        if (row.body_hash !== bodyHash) {
          throw errors.idempotencyKeyReused();
        }
        if (row.done) {
          return { replayed: true, status: row.status as number, body: row.response_body };
        }
      } else {
        await client.query(
          `INSERT INTO idempotency (workspace_id, user_id, key, body_hash, status, done)
           VALUES ($1,$2,$3,$4,0,false)`,
          [workspaceId, userId, key, bodyHash],
        );
      }
      // Run the command outside the client, then store the result.
      const result = await fn(async (status, body) => {
        await client.query(
          `UPDATE idempotency SET status = $4, response_body = $5, done = true
           WHERE workspace_id = $1 AND user_id = $2 AND key = $3`,
          [workspaceId, userId, key, status, JSON.stringify(body)],
        );
      });
      await client.query(
        `UPDATE idempotency SET status = $4, response_body = $5, done = true
         WHERE workspace_id = $1 AND user_id = $2 AND key = $3`,
        [workspaceId, userId, key, result.status, JSON.stringify(result.body)],
      );
      return { replayed: false, status: result.status, body: result.body };
    } finally {
      client.release();
    }
  });
}
