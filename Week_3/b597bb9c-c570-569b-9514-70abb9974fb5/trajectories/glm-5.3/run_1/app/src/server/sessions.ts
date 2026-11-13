import type { Request, Response, RequestHandler } from 'express';
import type { Db } from './db';
import { ApiError } from './api-errors';

/** Sessions, the person record, the sign-in and sign-out paths. */
export interface PersonRecord {
  id: string;
  name: string;
  email: string;
  handle: string;
}

export interface SessionStore {
  create(personId: string): Promise<string>;
  find(token: string): Promise<PersonRecord | null>;
  remove(token: string): Promise<void>;
  removeByPerson(personId: string): Promise<void>;
  tokenOf(personId: string): Promise<string | null>;
}

export function personFromRow(row: { id: string; name: string; email: string; handle: string }): PersonRecord {
  return { id: row.id, name: row.name, email: row.email, handle: row.handle };
}

export async function createSession(db: Db, personId: string, token: string): Promise<void> {
  await db.query('INSERT INTO sessions (token, person_id) VALUES ($1, $2)', [token, personId]);
}

export async function findSession(db: Db, token: string): Promise<PersonRecord | null> {
  const res = await db.query<{ id: string; name: string; email: string; handle: string }>(
    `SELECT p.id, p.name, p.email, p.handle FROM sessions s JOIN people p ON p.id = s.person_id WHERE s.token = $1`,
    [token],
  );
  if ((res.rowCount ?? 0) === 0) return null;
  return personFromRow(res.rows[0]!);
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.query('DELETE FROM sessions WHERE token = $1', [token]);
}

export async function findPersonByEmail(db: Db, email: string): Promise<(PersonRecord & { password_hash: string }) | null> {
  const res = await db.query<{ id: string; name: string; email: string; handle: string; password_hash: string }>(
    'SELECT id, name, email, handle, password_hash FROM people WHERE lower(email) = lower($1)',
    [email],
  );
  if ((res.rowCount ?? 0) === 0) return null;
  return res.rows[0]!;
}

export const sessionCookieName = 'gatecut_session';

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(sessionCookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(sessionCookieName, { path: '/' });
}

export function requireAuth(req: Request): PersonRecord {
  const person = (req as Request & { person: PersonRecord | null }).person;
  if (person === null) throw new ApiError('unauthenticated');
  return person;
}

export type { Request, Response, RequestHandler };
