import crypto from 'node:crypto';
import type { Config } from '../config.ts';
import type { PgPool } from '../db/pg.ts';
import type { KillBillApi } from '../services/killbill.ts';
import type { PocketBase } from '../services/pocketbase.ts';
import type { Storage } from '../services/storage.ts';
import type { Smtp } from '../services/smtp.ts';
import type { MailQueue } from '../services/mail.ts';

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'visitor' | 'curator' | 'lead_curator' | 'manager';
}

export interface App {
  config: Config;
  pool: PgPool;
  kb: KillBillApi;
  pb: PocketBase;
  storage: Storage;
  smtp: Smtp;
  mail: MailQueue;
  now(): number;
}

/** Sign-in sessions: the sl_session cookie, valid on every instance sharing the DB. */
export async function createSignin(app: App, userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  await app.pool.query(`INSERT INTO signins (token, user_id) VALUES ($1, $2)`, [token, userId]);
  return token;
}

export async function userForToken(app: App, token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const res = await app.pool.query(
    `SELECT user_id FROM signins WHERE token = $1`,
    [token],
  );
  const userId = res.rows[0]?.['user_id'];
  if (typeof userId !== 'string') return null;
  const user = await app.pb.getUserById(userId);
  return user ? { id: user.id, name: user.name, email: user.email, role: user.role } : null;
}

export async function destroySignin(app: App, token: string | undefined): Promise<void> {
  if (!token) return;
  await app.pool.query(`DELETE FROM signins WHERE token = $1`, [token]);
}

/** Staff action record: exactly one append-only row per action. */
export async function recordAction(
  app: App,
  actorEmail: string,
  action: string,
  targetType: string,
  targetId: string,
  detail?: unknown,
): Promise<void> {
  await app.pool.query(
    `INSERT INTO audit (actor_email, action, target_type, target_id, detail) VALUES ($1,$2,$3,$4,$5)`,
    [actorEmail, action, targetType, targetId, detail === undefined ? null : JSON.stringify(detail)],
  );
}
