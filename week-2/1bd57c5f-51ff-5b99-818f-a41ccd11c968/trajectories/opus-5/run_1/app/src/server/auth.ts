import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { db, type Queryable } from './db.js';
import { config } from './env.js';
import type { PersonRecord } from './model.js';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const SCRYPT_KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT_KEY_LENGTH);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'base64');
  const expected = Buffer.from(parts[2], 'base64');
  const key = await scrypt(password, salt, expected.length);
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export const SESSION_COOKIE = 'snaglight_session';

export async function createSession(personId: string): Promise<string> {
  const id = randomBytes(32).toString('base64url');
  await db.query(`insert into sessions (id, person_id) values ($1, $2)`, [id, personId]);
  return id;
}

export async function endSession(sessionId: string): Promise<void> {
  await db.query(`update sessions set ended_at = now() where id = $1 and ended_at is null`, [
    sessionId,
  ]);
}

export async function endOtherSessions(personId: string, keepSessionId: string): Promise<void> {
  await db.query(
    `update sessions set ended_at = now()
      where person_id = $1 and id <> $2 and ended_at is null`,
    [personId, keepSessionId],
  );
}

export type Account = { session: string; person: PersonRecord };

export async function resolveSession(
  sessionId: string | null,
  touch: boolean,
): Promise<Account | null> {
  if (sessionId === null) return null;
  const { rows } = await db.query(
    `select s.id, p.id as person_id, p.name, p.email, p.phone, p.is_owner
       from sessions s join people p on p.id = s.person_id
      where s.id = $1 and s.ended_at is null
        and s.last_seen_at > now() - ($2 || ' minutes')::interval`,
    [sessionId, String(config.sessionIdleMinutes)],
  );
  if (rows.length === 0) return null;
  if (touch) {
    await db.query(`update sessions set last_seen_at = now() where id = $1`, [sessionId]);
  }
  const row = rows[0];
  return {
    session: row.id as string,
    person: {
      id: row.person_id as string,
      name: row.name as string,
      email: row.email as string,
      phone: (row.phone as string | null) ?? null,
      isOwner: row.is_owner as boolean,
    },
  };
}

export async function findPersonByEmail(
  tx: Queryable,
  email: string,
): Promise<(PersonRecord & { passwordHash: string }) | null> {
  const { rows } = await tx.query(
    `select id, name, email, phone, password_hash, is_owner from people where lower(email) = lower($1)`,
    [email],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id as string,
    name: row.name as string,
    email: row.email as string,
    phone: (row.phone as string | null) ?? null,
    isOwner: row.is_owner as boolean,
    passwordHash: row.password_hash as string,
  };
}

export async function createPerson(
  tx: Queryable,
  name: string,
  email: string,
  phone: string | null,
  password: string,
): Promise<string> {
  const id = randomUUID();
  await tx.query(
    `insert into people (id, name, email, phone, password_hash) values ($1, $2, $3, $4, $5)`,
    [id, name, email, phone, await hashPassword(password)],
  );
  return id;
}
