import { randomBytes } from 'node:crypto';
import type { Role } from '../../shared/api.js';
import type { Queryable } from '../db/pool.js';
import { chairOf } from '../domain/sections.js';
import type { Person } from './context.js';

export const SESSION_COOKIE = 'qw_session';
const INACTIVITY_HOURS = 12;

interface PersonRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  chair_key: string | null;
  chair_section: string | null;
  chair_number: number | null;
  chair_label: string | null;
}

function personOf(row: PersonRow): Person {
  return { id: row.id, name: row.name, email: row.email, role: row.role, chair: chairOf(row) };
}

export function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const pair of cookieHeader.split(';')) {
    const index = pair.indexOf('=');
    if (index < 0) continue;
    if (pair.slice(0, index).trim() === name) return decodeURIComponent(pair.slice(index + 1).trim());
  }
  return null;
}

export async function personForSession(db: Queryable, sessionId: string): Promise<Person | null> {
  const result = await db.query<PersonRow>(
    `UPDATE sessions
        SET last_seen_at = now()
      WHERE id = $1 AND last_seen_at > now() - make_interval(hours => $2)
      RETURNING person_id`,
    [sessionId, INACTIVITY_HOURS],
  );
  if (result.rowCount === 0) return null;
  const people = await db.query<PersonRow>(
    `SELECT p.id, p.name, p.email, p.role, p.chair_key, p.chair_section, p.chair_number, p.chair_label
       FROM sessions s JOIN people p ON p.id = s.person_id
      WHERE s.id = $1`,
    [sessionId],
  );
  const row = people.rows[0];
  return row ? personOf(row) : null;
}

export async function signIn(db: Queryable, email: string, passcode: string): Promise<Person | null> {
  const result = await db.query<PersonRow>(
    `SELECT id, name, email, role, chair_key, chair_section, chair_number, chair_label
       FROM people
      WHERE lower(email) = lower($1) AND passcode = $2`,
    [email, passcode],
  );
  const row = result.rows[0];
  return row ? personOf(row) : null;
}

export async function startSession(db: Queryable, personId: string): Promise<string> {
  const id = randomBytes(32).toString('base64url');
  await db.query(`INSERT INTO sessions (id, person_id) VALUES ($1, $2)`, [id, personId]);
  return id;
}

export async function endSession(db: Queryable, sessionId: string): Promise<void> {
  await db.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
}

export function sessionCookie(sessionId: string): string {
  return `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${INACTIVITY_HOURS * 3600}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}
