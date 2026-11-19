import type { Express } from 'express';
import type { RouteCtx } from './services.js';
import { ApiError } from '../errors.js';
import type { Role } from '../../shared/types.js';
import { verifyPassword } from '../ids.js';
import { readJson, hasUnstorable } from '../validation.js';
import { readSessionCookie, createSession, destroySession, setSessionCookie, clearSessionCookie } from '../session.js';

export function registerSessionRoutes(app: Express, { wrap, svc }: RouteCtx): void {
  const { sql } = svc;

  app.post('/api/session', wrap(async (req, res) => {
    const body = await readJson(req);
    const email = typeof body.email === 'string' ? body.email : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const rows = await sql<{ id: string; email: string; display_name: string; handle: string; password_hash: string }>`SELECT * FROM users WHERE email_lower = ${email.trim().toLowerCase()}`;
    const user = rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new ApiError(401, 'invalid_credentials');
    }
    const token = await createSession(sql, user.id);
    setSessionCookie(res, token);
    res.json({
      user: { id: user.id, email: user.email, displayName: user.display_name, handle: user.handle },
    });
  }));

  app.delete('/api/session', wrap(async (req, res) => {
    const token = readSessionCookie(req);
    if (token) await destroySession(sql, token);
    clearSessionCookie(res);
    res.status(204).end();
  }));

  app.get('/api/me', wrap(async (req, res) => {
    const user = await requireUser(svc, req);
    const ws = await sql<{ id: string; name: string; role: string }>`
      SELECT w.id, w.name, m.role FROM workspace_members m
      JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.user_id = ${user.id} ORDER BY w.name LIMIT 1`;
    res.json({
      user: { id: user.id, email: user.email, displayName: user.displayName, handle: user.handle },
      workspace: ws[0] ? { id: ws[0].id, name: ws[0].name, role: ws[0].role } : null,
    });
  }));

  app.patch('/api/me', wrap(async (req, res) => {
    const user = await requireUser(svc, req);
    const body = await readJson(req);
    if (typeof body.displayName !== 'string') {
      throw new ApiError(422, 'invalid', { displayName: 'required' });
    }
    const trimmed = body.displayName.trim();
    if (trimmed.length < 1 || trimmed.length > 80 || hasUnstorable(body.displayName)) {
      throw new ApiError(422, 'invalid', { displayName: 'length' });
    }
    await sql`UPDATE users SET display_name = ${body.displayName} WHERE id = ${user.id}`;
    const rows = await sql<{ id: string; email: string; display_name: string; handle: string }>`SELECT id, email, display_name, handle FROM users WHERE id = ${user.id}`;
    res.json({
      user: { id: rows[0].id, email: rows[0].email, displayName: rows[0].display_name, handle: rows[0].handle },
    });
  }));
}

export async function requireUser(svc: RouteCtx['svc'], req: import('express').Request) {
  const token = readSessionCookie(req);
  if (!token) throw new ApiError(401, 'unauthenticated');
  const rows = await svc.sql<{ id: string; email: string; display_name: string; handle: string }>`
    SELECT u.id, u.email, u.display_name, u.handle
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ${token}`;
  if (!rows[0]) throw new ApiError(401, 'unauthenticated');
  return { id: rows[0].id, email: rows[0].email, displayName: rows[0].display_name, handle: rows[0].handle };
}

export interface MemberCtx {
  user: { id: string; email: string; displayName: string; handle: string };
  role: 'owner' | 'editor' | 'reviewer' | 'viewer';
}

export async function requireMember(svc: RouteCtx['svc'], req: import('express').Request, projectId: string): Promise<MemberCtx> {
  const user = await requireUser(svc, req);
  const rows = await svc.sql<{ role: Role }>`
    SELECT role FROM memberships WHERE project_id = ${projectId} AND user_id = ${user.id}`;
  if (!rows[0]) throw new ApiError(404, 'not_found');
  return { user, role: rows[0].role };
}

export function person(user: { id: string; displayName: string; handle: string }) {
  return { id: user.id, displayName: user.displayName, handle: user.handle };
}
