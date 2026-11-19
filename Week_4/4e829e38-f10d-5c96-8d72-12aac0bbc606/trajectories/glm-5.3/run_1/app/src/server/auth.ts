import { Request, Response, NextFunction } from 'express';
import { query } from './db';
import { AuthedRequest } from './apiutil';
import { token } from './passwords';

export interface SessionPerson {
  personId: string;
  name: string;
  email: string;
  teamIds: string[];
  roles: Record<string, string>;
}

export const SESSION_COOKIE = 'ew_session';

export async function personFromCookie(req: Request): Promise<SessionPerson | null> {
  const raw = req.header('cookie') ?? '';
  const m = /(?:^|;\s*)ew_session=([^;]+)/.exec(raw);
  const t = m ? decodeURIComponent(m[1]) : null;
  if (!t) return null;
  const r = await query<{ id: string; name: string; email: string; team_id: string; role: string }>(
    `SELECT p.id, p.name, p.email, tm.team_id, tm.role
       FROM sessions s
       JOIN people p ON p.id = s.person_id
       LEFT JOIN team_members tm ON tm.person_id = p.id
      WHERE s.token = $1`, [t]);
  if (r.rowCount === 0 || !r.rows[0]?.id) return null;
  const first = r.rows[0];
  const teamIds: string[] = [];
  const roles: Record<string, string> = {};
  for (const row of r.rows) {
    if (row.team_id) {
      teamIds.push(row.team_id);
      roles[row.team_id] = row.role;
    }
  }
  return { personId: first.id, name: first.name, email: first.email, teamIds, roles };
}

export function requireAuth(): (req: Request, res: Response, next: NextFunction) => void {
  return async (req, res, next) => {
    const p = await personFromCookie(req);
    if (!p) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const ar = req as AuthedRequest;
    ar.personId = p.personId;
    ar.personName = p.name;
    ar.teamIds = p.teamIds;
    ar.personRole = p.roles;
    next();
  };
}

/**
 * Router-level guard that only signs in the caller for the paths this router
 * owns, so public and grading routes on other routers still pass through.
 */
export function requireAuthFor(...prefixes: string[]): (req: Request, res: Response, next: NextFunction) => void {
  return async (req, res, next) => {
    const path = req.path;
    const mine = prefixes.some(p => path === p || path.startsWith(p));
    if (!mine) {
      next();
      return;
    }
    const p = await personFromCookie(req);
    if (!p) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const ar = req as AuthedRequest;
    ar.personId = p.personId;
    ar.personName = p.name;
    ar.teamIds = p.teamIds;
    ar.personRole = p.roles;
    next();
  };
}

export async function startSession(res: Response, personId: string): Promise<string> {
  const t = token();
  await query(`INSERT INTO sessions (token, person_id) VALUES ($1, $2)`, [t, personId]);
  res.setHeader('set-cookie', `${SESSION_COOKIE}=${encodeURIComponent(t)}; Path=/; HttpOnly; SameSite=Lax`);
  return t;
}

export async function endSession(req: Request, res: Response): Promise<void> {
  const raw = req.header('cookie') ?? '';
  const m = /(?:^|;\s*)ew_session=([^;]+)/.exec(raw);
  const t = m ? decodeURIComponent(m[1]) : null;
  if (t) await query(`DELETE FROM sessions WHERE token = $1`, [t]);
  res.setHeader('set-cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}
