import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from './db';
import { ApiError, fieldCopy } from './errors';
import { SESSION_COOKIE, requireViewer } from './auth';
import { clearSessionCookie, setSessionCookie, type AppServices } from './context';
import { hashPassword, newToken, uuid, verifyPassword } from './passwords';
import { projectUser } from './user-projection';
import { ROLES, type Role } from '../shared/terms';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface WorkspaceRow {
  id: string;
  name: string;
  time_zone: string;
}

interface UserRowFull {
  id: string;
  workspace_id: string;
  name: string;
  handle: string;
  email: string;
  role: Role;
  status: string;
  password_hash: string;
}

export async function findWorkspaceByUser(db: Db, userId: string): Promise<WorkspaceRow> {
  const res = await db.pool.query<WorkspaceRow>(
    `SELECT w.id, w.name, w.time_zone FROM workspaces w JOIN users u ON u.workspace_id = w.id WHERE u.id = $1`,
    [userId],
  );
  return res.rows[0];
}

export function workspaceView(w: WorkspaceRow): Record<string, unknown> {
  return { id: w.id, name: w.name, time_zone: w.time_zone };
}

export async function createSession(db: Db, userId: string, createdAt: Date): Promise<string> {
  const token = newToken();
  await db.pool.query('INSERT INTO sessions (token, user_id, created_at) VALUES ($1, $2, $3)', [token, userId, createdAt]);
  return token;
}

export function registerSessionRoutes(app: FastifyInstance, services: AppServices): void {
  app.post('/api/session', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, unknown> | null;
    const errors: Record<string, string> = {};
    const emailRaw = typeof body?.email === 'string' ? body.email.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    if (emailRaw === '') errors.email = fieldCopy('email');
    if (password === '') errors.password = fieldCopy('passwordSignIn');
    if (Object.keys(errors).length > 0) throw new ApiError('validation', undefined, errors);
    const accepted = acceptedFields(body ?? {}, ['email', 'password']);
    if (accepted.length > 0) {
      for (const key of accepted) errors[key] = fieldCopy('unaccepted');
      throw new ApiError('validation', undefined, errors);
    }

    const res = await services.db.pool.query<UserRowFull>(
      'SELECT id, workspace_id, name, handle, email, role, status, password_hash FROM users WHERE lower(email) = lower($1)',
      [emailRaw],
    );
    if (res.rowCount === 0 || res.rows[0].status !== 'active' || !(await verifyPassword(password, res.rows[0].password_hash))) {
      throw new ApiError('invalid_credentials');
    }
    const user = res.rows[0];
    const workspace = await findWorkspaceByUser(services.db, user.id);
    const token = await createSession(services.db, user.id, services.clock.now());
    setSessionCookie(reply, token);
    return {
      user: projectUser(user, { id: user.id, workspaceId: user.workspace_id, role: user.role }),
      workspace: workspaceView(workspace),
    };
  });

  app.delete('/api/session', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) {
      const rows = await services.db.pool.query<{ user_id: string; workspace_id: string }>(
        'SELECT s.user_id, u.workspace_id FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1',
        [token],
      );
      if (rows.rowCount === 1) {
        const { user_id, workspace_id } = rows.rows[0];
        await services.db.pool.query('DELETE FROM sessions WHERE token = $1', [token]);
        const { logPersonalEvent } = await import('./events');
        await logPersonalEvent(services.db, services.clock, 'session.ended', workspace_id, user_id, {});
      }
    }
    clearSessionCookie(reply);
    reply.status(204);
    return null;
  });

  app.get('/api/me', async (request: FastifyRequest) => {
    const viewer = await requireViewer(services.db, request);
    const userRes = await services.db.pool.query<UserRowFull>(
      'SELECT id, workspace_id, name, handle, email, role, status, password_hash FROM users WHERE id = $1',
      [viewer.id],
    );
    const user = userRes.rows[0];
    const workspace = await findWorkspaceByUser(services.db, viewer.id);
    return {
      user: projectUser(user, viewer),
      workspace: workspaceView(workspace),
    };
  });
}

/** Lists the unaccepted keys of a body, in request order. */
export function acceptedFields(body: Record<string, unknown>, accepted: string[]): string[] {
  const out: string[] = [];
  for (const key of Object.keys(body)) {
    if (!accepted.includes(key)) out.push(key);
  }
  return out;
}
