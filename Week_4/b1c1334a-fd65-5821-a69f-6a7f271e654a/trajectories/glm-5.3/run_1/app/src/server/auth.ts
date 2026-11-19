/**
 * Sessions and sign-in: seeded accounts, scrypt password hashes, random
 * session tokens in Postgres, and byte-identical 401s.
 */
import { PoolClient } from 'pg';
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

export interface Session {
  token: string;
  personId: string;
}

const hashPassword = async (password: string, salt: string): Promise<string> => {
  const derived = await scrypt(password, salt, 32);
  return `${salt}:${derived.toString('hex')}`;
};

export const makePasswordHash = (password: string): Promise<string> =>
  hashPassword(password, randomBytes(16).toString('hex'));

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hex] = stored.split(':');
  if (!salt || !hex) return false;
  const derived = await scrypt(password, salt, 32);
  const expected = Buffer.from(hex, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export async function createSession(client: PoolClient, personId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await client.query('INSERT INTO sessions (token, person_id) VALUES ($1, $2)', [token, personId]);
  return token;
}

export async function personForSession(
  client: PoolClient,
  token: string | undefined,
): Promise<{ id: string; email: string; display_name: string } | null> {
  if (!token) return null;
  const r = await client.query<{ id: string; email: string; display_name: string }>(
    `SELECT p.id, p.email, p.display_name FROM sessions s
     JOIN persons p ON p.id = s.person_id WHERE s.token = $1`,
    [token],
  );
  return r.rows[0] ?? null;
}

export async function endSession(client: PoolClient, token: string | undefined): Promise<void> {
  if (!token) return;
  await client.query('DELETE FROM sessions WHERE token = $1', [token]);
}
