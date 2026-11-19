import type { Module } from '../http/app.ts';
import { HttpError } from '../http/errors.ts';
import { json, noContent } from '../http/reply.ts';
import { createUser, findUser, normalizeUsername, TAKEN_MESSAGE } from './accounts.ts';
import { verifyPassword } from './password.ts';
import { authSchema, endSession, startSession } from './sessions.ts';

export const mountAuth: Module = (app) => {
  app.schema(authSchema);

  app.publicRoute({
    method: 'POST',
    path: '/api/auth/register',
    body: 'json',
    handler: async (ctx) => {
      const body = ctx.object();
      const user = await createUser(app, body.username, body.password);
      if (!user) throw new HttpError(409, { error: 'username_taken', errors: { username: TAKEN_MESSAGE } });
      return json(201, { user }, { 'Set-Cookie': await startSession(app, user.id) });
    },
  });

  app.publicRoute({
    method: 'POST',
    path: '/api/auth/login',
    body: 'json',
    rate: {
      limiter: app.limiters.login,
      key: (ctx) => {
        const body = ctx.peek();
        const name = typeof body === 'object' && body !== null && 'username' in body ? body.username : null;
        return typeof name === 'string' ? normalizeUsername(name) : null;
      },
    },
    handler: async (ctx) => {
      const body = ctx.object();
      const username = typeof body.username === 'string' ? body.username : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const user = await findUser(app, username);
      const stored = user
        ? await app.db.row<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [user.id])
        : null;
      if (!user || !stored || !(await verifyPassword(password, stored.password_hash))) {
        throw new HttpError(401, { error: 'invalid_credentials' });
      }
      return json(200, { user }, { 'Set-Cookie': await startSession(app, user.id) });
    },
  });

  app.publicRoute({
    method: 'POST',
    path: '/api/auth/logout',
    handler: async (ctx) => noContent({ 'Set-Cookie': await endSession(app, ctx.req) }),
  });

  app.route({
    method: 'GET',
    path: '/api/me',
    handler: async (ctx) => {
      const projects = await app.db.rows<{ id: string; name: string; role: string }>(
        `SELECT p.id, p.name, m.role FROM project_members m JOIN projects p ON p.id = m.project_id
         WHERE m.user_id = $1 ORDER BY p.created_at, p.id`,
        [ctx.user.id],
      );
      return json(200, { user: ctx.user, projects });
    },
  });
};
