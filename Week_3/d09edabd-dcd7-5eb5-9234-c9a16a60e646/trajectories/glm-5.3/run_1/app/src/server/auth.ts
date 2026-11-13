import type { NextFunction, Request, Response } from 'express';
import { dbUnavailable, notFound, oneField, unauthenticated } from './errors.js';
import { pool } from './db.js';
import type { User, Workspace } from '../shared/types.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User & { workspaceId: string };
      workspace?: Workspace;
      opId?: string;
    }
  }
}

export interface AuthedRequest extends Request {
  user: User & { workspaceId: string };
}

export async function loadUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.kb_session;
  if (!token) { next(unauthenticated()); return; }
  try {
    const r = await pool.query(
      `SELECT u.id, u.email, u.display_name, u.role, u.workspace_id, w.name AS workspace_name
       FROM sessions_auth s JOIN users u ON u.id = s.user_id JOIN workspaces w ON w.id = u.workspace_id
       WHERE s.token = $1 AND s.expires_at > now()`,
      [token]
    );
    if (!r.rows.length) { next(unauthenticated()); return; }
    const row = r.rows[0];
    req.user = {
      id: row.id, email: row.email, displayName: row.display_name,
      role: row.role, workspaceId: row.workspace_id,
    };
    req.workspace = { id: row.workspace_id, name: row.workspace_name };
    next();
  } catch {
    next(dbUnavailable());
  }
}

export function requireAuth(req: Request): AuthedRequest {
  if (!req.user) throw unauthenticated();
  return req as AuthedRequest;
}

/** A room of this workspace, else 404. */
export async function roomOf(roomId: string, workspaceId: string): Promise<{ id: string }> {
  const r = await pool.query(`SELECT id FROM rooms WHERE id = $1 AND workspace_id = $2`, [roomId, workspaceId]);
  if (!r.rows.length) throw notFound();
  return r.rows[0];
}

export function validateOpId(value: string | undefined): void {
  if (value === undefined || value === '') return;
  if (value.length < 8 || value.length > 64 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw oneField('opId', 'invalid op id');
  }
}
