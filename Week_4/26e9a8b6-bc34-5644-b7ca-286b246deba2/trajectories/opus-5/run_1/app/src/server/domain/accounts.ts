import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { execute, query, queryOne } from '../db/index.js';
import type { SessionUser } from '../../shared/types.js';

function deriveKey(
  password: string,
  salt: Buffer,
  keyLength: number,
  cost: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, cost, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_COST = { N: 16384, r: 8, p: 1 };

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;
export const NAME_MIN = 1;
export const NAME_MAX = 80;

interface UserRow extends Record<string, unknown> {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  confirmed: boolean;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await deriveKey(password, salt, SCRYPT_KEY_LENGTH, SCRYPT_COST);
  return `scrypt$${SCRYPT_COST.N}$${SCRYPT_COST.r}$${SCRYPT_COST.p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const derived = await deriveKey(password, Buffer.from(salt, 'base64'), expected.byteLength, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return derived.byteLength === expected.byteLength && timingSafeEqual(derived, expected);
}

export const toSessionUser = (row: UserRow): SessionUser => ({
  id: row.id,
  name: row.name,
  email: row.email,
  confirmed: row.confirmed,
});

export async function createAccount(
  name: string,
  email: string,
  password: string,
): Promise<SessionUser | null> {
  const id = randomUUID();
  const rows = await query<UserRow>(
    `INSERT INTO users (id, name, email, password_hash, confirmed)
     VALUES ($1, $2, $3, $4, false)
     ON CONFLICT (lower(email)) DO NOTHING
     RETURNING id, name, email, password_hash, confirmed`,
    [id, name, email, await hashPassword(password)],
  );
  const row = rows[0];
  return row ? toSessionUser(row) : null;
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  return await queryOne<UserRow>(
    'SELECT id, name, email, password_hash, confirmed FROM users WHERE lower(email) = lower($1)',
    [email],
  );
}

export async function findUserById(id: string): Promise<SessionUser | null> {
  const row = await queryOne<UserRow>(
    'SELECT id, name, email, password_hash, confirmed FROM users WHERE id = $1',
    [id],
  );
  return row ? toSessionUser(row) : null;
}

export async function startSession(userId: string): Promise<string> {
  const id = randomBytes(32).toString('base64url');
  await execute('INSERT INTO sessions (id, user_id) VALUES ($1, $2)', [id, userId]);
  return id;
}

export async function endSession(sessionId: string): Promise<void> {
  await execute('DELETE FROM sessions WHERE id = $1', [sessionId]);
}

export async function userForSession(sessionId: string | null): Promise<SessionUser | null> {
  if (sessionId === null) return null;
  const row = await queryOne<UserRow>(
    `SELECT u.id, u.name, u.email, u.password_hash, u.confirmed
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1`,
    [sessionId],
  );
  return row ? toSessionUser(row) : null;
}

/** A newer message voids every earlier token for that account. */
export async function issueConfirmToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await execute('DELETE FROM confirm_tokens WHERE user_id = $1', [userId]);
  await execute('INSERT INTO confirm_tokens (token, user_id) VALUES ($1, $2)', [token, userId]);
  return token;
}

export type ConfirmOutcome = 'confirmed' | 'invalid';

/**
 * A token stops working after its life on the server clock, as soon as it is
 * used, and as soon as a newer message voids it.
 */
export async function confirmWithToken(token: string): Promise<ConfirmOutcome> {
  const row = await queryOne<{ user_id: string; expired: boolean }>(
    `SELECT user_id, (sent_at + make_interval(secs => $2)) < now() AS expired
     FROM confirm_tokens WHERE token = $1 AND spent = false`,
    [token, config.limits.confirm_token_ttl_seconds],
  );
  if (!row) return 'invalid';
  await execute('UPDATE confirm_tokens SET spent = true WHERE token = $1', [token]);
  if (row.expired) return 'invalid';
  await execute('UPDATE users SET confirmed = true WHERE id = $1', [row.user_id]);
  return 'confirmed';
}

export function confirmMessage(token: string): { subject: string; body: string } {
  return {
    subject: 'Confirm your Pennywasher account',
    body: `Welcome to Pennywasher Works.\n\nConfirm your account by opening this link:\n${config.publicUrl}/confirm?token=${token}\n`,
  };
}
