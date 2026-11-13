/** Desk sessions: one cookie per signed-in desk, held in PostgreSQL. */

import { randomBytes } from 'node:crypto';
import type { Role } from '../shared/desk.js';
import { isRole } from '../shared/desk.js';
import type { SessionBody } from '../shared/model.js';
import { normaliseText } from '../shared/text.js';
import type { Db } from './db.js';
import { badCode, invalidFields } from './errors.js';

export const SESSION_COOKIE = 'rk_desk';

export interface Session {
  token: string;
  role: Role;
  teamId: number | null;
  teamName: string | null;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict`;
}

export function clearedCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

export function cookieToken(cookieHeader: string | undefined): string | null {
  if (cookieHeader === undefined) return null;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return rest.join('=');
  }
  return null;
}

export async function readSession(db: Db, cookieHeader: string | undefined): Promise<Session | null> {
  const token = cookieToken(cookieHeader);
  if (token === null || token === '') return null;
  const result = await db.query<{ role: string; team_id: number | null; name: string | null }>(
    `select s.role, s.team_id, t.name
       from sessions s left join teams t on t.id = s.team_id
      where s.token = $1`,
    [token],
  );
  const row = result.rows[0];
  if (row === undefined || !isRole(row.role)) return null;
  return { token, role: row.role, teamId: row.team_id, teamName: row.name };
}

export async function openSession(db: Db, code: unknown): Promise<{ token: string; body: SessionBody }> {
  if (typeof code !== 'string') throw invalidFields({ code: code === undefined || code === null ? 'required' : 'invalid' });
  const trimmed = normaliseText(code);
  if (trimmed === '') throw invalidFields({ code: 'required' });
  const found = await db.query<{ role: string; team_id: number | null; name: string | null }>(
    `select d.role, d.team_id, t.name
       from desk_codes d left join teams t on t.id = d.team_id
      where d.code = $1`,
    [trimmed],
  );
  const row = found.rows[0];
  if (row === undefined || !isRole(row.role)) throw badCode();
  const token = randomBytes(24).toString('hex');
  await db.query('insert into sessions (token, role, team_id) values ($1, $2, $3)', [
    token,
    row.role,
    row.team_id,
  ]);
  return { token, body: { role: row.role, team_id: row.team_id, team_name: row.name } };
}

export async function closeSession(db: Db, token: string): Promise<void> {
  await db.query('delete from sessions where token = $1', [token]);
}
