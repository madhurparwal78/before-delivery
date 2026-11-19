import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { newId, query } from './db.js';
import type { Person } from './http.js';

export const SESSION_COOKIE = 'everyweek_session';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, digest] = stored.split(':');
  if (!salt || !digest) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(digest, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function verificationCode(): string {
  return String(randomInt(100000, 1000000));
}

export async function createSession(personId: string): Promise<string> {
  const token = randomBytes(24).toString('hex');
  await query(`INSERT INTO sessions (token, person_id) VALUES ($1, $2)`, [token, personId]);
  return token;
}

export async function personForToken(token: string | undefined): Promise<Person | null> {
  if (!token) return null;
  const rows = await query<Person>(
    `SELECT p.id, p.name, p.email, p.verified FROM sessions s JOIN people p ON p.id = s.person_id
     WHERE s.token = $1`,
    [token],
  );
  return rows.length > 0 ? rows[0] : null;
}

export async function dropSession(token: string | undefined): Promise<void> {
  if (token) await query(`DELETE FROM sessions WHERE token = $1`, [token]);
}

export async function teamsOf(
  personId: string,
): Promise<{ id: string; name: string; role: string }[]> {
  return query(
    `SELECT t.id, t.name, m.role FROM teams t JOIN memberships m ON m.team_id = t.id
     WHERE m.person_id = $1 ORDER BY t.name`,
    [personId],
  );
}

export async function isCoordinator(personId: string, teamId: string): Promise<boolean> {
  const rows = await query<{ role: string }>(
    `SELECT role FROM memberships WHERE person_id = $1 AND team_id = $2`,
    [personId, teamId],
  );
  return rows.length > 0 && rows[0].role === 'coordinator';
}

export async function createPerson(input: {
  name: string;
  email: string;
  password: string;
  verified?: boolean;
  code?: string | null;
}): Promise<{ id: string; code: string | null }> {
  const id = newId();
  const code = input.verified ? null : (input.code ?? verificationCode());
  await query(
    `INSERT INTO people (id, name, email, password_hash, verified, verify_code)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, input.name, input.email.toLowerCase(), hashPassword(input.password), input.verified ?? false, code],
  );
  return { id, code };
}
