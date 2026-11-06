import { randomBytes } from 'node:crypto';
import { db } from '../db.ts';
import type { Role } from '../../shared/types.ts';
import type { Viewer } from '../store.ts';

export const SESSION_COOKIE = 'tally_session';

interface PersonRow {
  id: string;
  name: string;
  role: Role;
  household_code: string | null;
}

export interface SessionInfo {
  id: string;
  personKey: string;
  viewer: Viewer;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const jar: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    jar[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return jar;
}

export function personByAccessCode(code: string): PersonRow | undefined {
  return db.prepare('SELECT id, name, role, household_code FROM people WHERE access_code = ?').get(code) as
    | PersonRow
    | undefined;
}

export function createSession(personId: string): string {
  const id = randomBytes(24).toString('base64url');
  db.prepare('INSERT INTO sessions (id, person_key, created_at) VALUES (?, ?, ?)').run(
    id,
    personId,
    new Date().toISOString(),
  );
  return id;
}

export function destroySession(id: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

export function sessionFor(cookieHeader: string | undefined): SessionInfo | null {
  const token = parseCookies(cookieHeader)[SESSION_COOKIE];
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT s.id AS id, p.id AS person_id, p.name AS name, p.role AS role, p.household_code AS household_code
       FROM sessions s JOIN people p ON p.id = s.person_key WHERE s.id = ?`,
    )
    .get(token) as { id: string; person_id: string; name: string; role: Role; household_code: string | null } | undefined;
  if (!row) return null;
  return {
    id: row.id,
    personKey: row.person_id,
    viewer: { role: row.role, name: row.name, householdCode: row.household_code },
  };
}

export function sessionCookie(id: string): string {
  return `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
