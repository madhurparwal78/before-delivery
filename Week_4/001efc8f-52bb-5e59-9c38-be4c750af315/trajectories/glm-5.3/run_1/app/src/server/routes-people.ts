import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ApiError, fieldCopy } from './errors';
import { projectUser } from './user-projection';
import { requireViewer } from './auth';
import type { AppServices } from './context';
import { acceptedFields, findWorkspaceByUser, workspaceView } from './routes-session';
import { setSessionCookie } from './context';
import { hashPassword, newToken, uuid } from './passwords';
import { enqueueInviteEmail } from './invites';
import { ROLES, type Role, type UserStatus } from '../shared/terms';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_RE = /[\u0000-\u001F\u007F]/;

export function registerPeopleRoutes(app: FastifyInstance, services: AppServices): void {
  app.get('/api/workspace/members', async (request: FastifyRequest) => {
    const viewer = await requireViewer(services.db, request);
    const q = typeof (request.query as Record<string, string>).q === 'string'
      ? (request.query as Record<string, string>).q
      : '';
    const params: unknown[] = [viewer.workspaceId];
    let sql = 'SELECT id, workspace_id, name, handle, email, role, status FROM users WHERE workspace_id = $1';
    if (q.trim() !== '') {
      params.push(q);
      if (viewer.role === 'ops_manager') {
        sql += ` AND (lower(name) LIKE lower($2 || '%') OR lower(handle) LIKE lower($2 || '%') OR lower(email) LIKE lower($2 || '%'))`;
      } else {
        sql += ` AND (lower(name) LIKE lower($2 || '%') OR lower(handle) LIKE lower($2 || '%'))`;
      }
    }
    sql += ' ORDER BY name';
    const res = await services.db.pool.query(sql, params);
    return {
      members: res.rows.map((row: { id: string; name: string; handle: string; email: string; role: Role; status: UserStatus }) =>
        projectUser(row, viewer),
      ),
    };
  });

  app.post('/api/workspace/members', async (request: FastifyRequest, reply: FastifyReply) => {
    const viewer = await requireViewer(services.db, request);
    if (viewer.role !== 'ops_manager') throw new ApiError('forbidden');
    const body = request.body as Record<string, unknown> | null ?? {};
    const errors: Record<string, string> = {};
    const unaccepted = acceptedFields(body, ['name', 'email', 'role']);
    for (const key of unaccepted) errors[key] = fieldCopy('unaccepted');

    const nameRaw = typeof body.name === 'string' ? body.name : '';
    const name = nameRaw.trim();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const role = typeof body.role === 'string' ? body.role : '';

    if (name === '') errors.name = fieldCopy('nameEmpty');
    else if (CONTROL_RE.test(name)) errors.name = fieldCopy('nameControl');
    else if (name.length > 80) errors.name = fieldCopy('nameTooLong');
    if (email === '' || !EMAIL_RE.test(email)) errors.email = fieldCopy('email');
    if (!(ROLES as readonly string[]).includes(role)) errors.role = fieldCopy('role');
    if (Object.keys(errors).length > 0) throw new ApiError('validation', undefined, errors);

    const taken = await services.db.pool.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [email]);
    if (taken.rowCount && taken.rowCount > 0) throw new ApiError('email_taken');

    const workspace = await findWorkspaceByUser(services.db, viewer.id);
    const handle = email.split('@')[0];
    const inviteToken = newToken(24);
    const userId = uuid();
    const now = services.clock.now();
    await services.db.tx(async (client) => {
      await client.query(
        'INSERT INTO invites (token, workspace_id, name, email, role, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
        [inviteToken, viewer.workspaceId, name, email, role, now],
      );
      await client.query(
        'INSERT INTO users (id, workspace_id, name, handle, email, role, status, password_hash, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [userId, viewer.workspaceId, name, handle, email, role, 'invited', '', now],
      );
    });

    const invited = await enqueueInviteEmail(services, { email, name, workspaceName: workspace.name, token: inviteToken, inviterName: (await services.db.pool.query('SELECT name FROM users WHERE id = $1', [viewer.id])).rows[0].name });
    reply.status(201);
    return {
      member: projectUser({ id: userId, name, handle, email, role: role as Role, status: 'invited' }, viewer),
      invite_email: invited ? 'sent' : 'queued',
    };
  });

  app.delete('/api/workspace/members/:userId', async (request: FastifyRequest, reply: FastifyReply) => {
    const viewer = await requireViewer(services.db, request);
    if (viewer.role !== 'ops_manager') throw new ApiError('forbidden');
    const targetId = (request.params as Record<string, string>).userId;
    if (targetId === viewer.id) throw new ApiError('cannot_deactivate_self');
    const res = await services.db.pool.query(
      'SELECT id, workspace_id, name, handle, email, role, status FROM users WHERE id = $1',
      [targetId],
    );
    if (res.rowCount === 0 || res.rows[0].workspace_id !== viewer.workspaceId) throw new ApiError('not_found');
    const { logPersonalEvent } = await import('./events');
    await services.db.tx(async (client) => {
      await client.query('UPDATE users SET status = $1 WHERE id = $2', ['deactivated', targetId]);
      await client.query('DELETE FROM memberships WHERE user_id = $1', [targetId]);
      await client.query('DELETE FROM sessions WHERE user_id = $1', [targetId]);
    });
    await logPersonalEvent(services.db, services.clock, 'session.ended', res.rows[0].workspace_id, targetId, {});
    const row = res.rows[0];
    return {
      member: projectUser({ id: row.id, name: row.name, handle: row.handle, email: row.email, role: row.role, status: 'deactivated' }, viewer),
    };
  });

  app.get('/api/invites/:token', async (request: FastifyRequest) => {
    const token = (request.params as Record<string, string>).token;
    const res = await services.db.pool.query<{ workspace_id: string; name: string; email: string; used_at: Date | null }>(
      'SELECT workspace_id, name, email, used_at FROM invites WHERE token = $1',
      [token],
    );
    if (res.rowCount === 0 || res.rows[0].used_at !== null) throw new ApiError('not_found');
    const ws = await services.db.pool.query('SELECT id, name, time_zone FROM workspaces WHERE id = $1', [res.rows[0].workspace_id]);
    return { workspace_name: ws.rows[0].name, name: res.rows[0].name, email: res.rows[0].email };
  });

  app.post('/api/invites/:token/accept', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = (request.params as Record<string, string>).token;
    const body = request.body as Record<string, unknown> | null ?? {};
    const errors: Record<string, string> = {};
    for (const key of acceptedFields(body, ['password'])) errors[key] = fieldCopy('unaccepted');
    const password = typeof body.password === 'string' ? body.password : '';
    if (password.length < 12 || password.length > 128) errors.password = fieldCopy('passwordJoin');
    if (Object.keys(errors).length > 0) throw new ApiError('validation', undefined, errors);

    const res = await services.db.pool.query(
      'SELECT workspace_id, name, email, role, used_at FROM invites WHERE token = $1',
      [token],
    );
    if (res.rowCount === 0 || res.rows[0].used_at !== null) throw new ApiError('not_found');
    const invite = res.rows[0];

    let userId = '';
    await services.db.tx(async (client) => {
      const updated = await client.query(
        'UPDATE invites SET used_at = $2 WHERE token = $1 AND used_at IS NULL RETURNING workspace_id, name, email, role',
        [token, services.clock.now()],
      );
      if (updated.rowCount === 0) throw new ApiError('not_found');
      const userRes = await client.query<{ id: string }>(
        'SELECT id FROM users WHERE lower(email) = lower($1)',
        [invite.email],
      );
      const hash = await hashPassword(password);
      if (userRes.rowCount === 0) {
        userId = uuid();
        await client.query(
          'INSERT INTO users (id, workspace_id, name, handle, email, role, status, password_hash, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [userId, invite.workspace_id, invite.name, invite.email.split('@')[0], invite.email, invite.role, 'active', hash, services.clock.now()],
        );
      } else {
        userId = userRes.rows[0].id;
        await client.query(
          'UPDATE users SET status = $2, password_hash = $3, role = $4, name = $5 WHERE id = $1',
          [userId, 'active', hash, invite.role, invite.name],
        );
      }
    });

    const userRow = await services.db.pool.query(
      'SELECT id, workspace_id, name, handle, email, role, status FROM users WHERE id = $1',
      [userId],
    );
    const workspace = await findWorkspaceByUser(services.db, userId);
    const token2 = newToken();
    await services.db.pool.query('INSERT INTO sessions (token, user_id, created_at) VALUES ($1,$2,$3)', [token2, userId, services.clock.now()]);
    setSessionCookie(reply, token2);
    const user = userRow.rows[0];
    return {
      user: projectUser(user, { id: user.id, workspaceId: user.workspace_id, role: user.role }),
      workspace: workspaceView(workspace),
    };
  });
}
