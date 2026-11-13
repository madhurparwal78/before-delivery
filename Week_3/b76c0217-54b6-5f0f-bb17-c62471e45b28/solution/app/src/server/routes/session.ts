import { createSession, destroySession, SESSION_COOKIE, verifyPassword, type Principal } from '../auth';
import { db, one } from '../db';
import { fail } from '../errors';
import { clearedSessionCookie, cookies, endpoint, reply, sessionCookie } from '../http';
import { Fields } from '../input';
import { safeNext } from '../domain/safe-next';
import type { MeJson } from '../../shared/types';

export function meJson(principal: Principal): MeJson {
  return { user: principal.user, team: { id: principal.teamId, name: principal.teamName }, role: principal.role };
}

export function sessionRoutes(): void {
  endpoint('GET', '/api/health', { access: 'public', handle: async () => reply.json(200, { status: 'ok' }) });

  endpoint('POST', '/api/session', {
    access: 'public',
    body: 'json',
    handle: async (ctx) => {
      const fields = new Fields(ctx.json);
      const email = fields.text('email', 320).toLowerCase();
      const password = fields.raw('password');
      fields.check();
      const user = await one<{ id: string; email: string; name: string; passwordHash: string }>(
        db,
        'select id, email, name, password_hash from users where email = $1',
        [email],
      );
      const valid = await verifyPassword(password, user?.passwordHash ?? null);
      if (user === null || !valid) {
        throw fail.invalidCredentials();
      }
      const token = await createSession(user.id);
      return reply.json(
        200,
        { user: { id: user.id, email: user.email, name: user.name }, redirectTo: safeNext(ctx.json.next, '/app') },
        { 'Set-Cookie': sessionCookie(token) },
      );
    },
  });

  endpoint('DELETE', '/api/session', {
    access: 'public',
    handle: async (ctx) => {
      const token = cookies(ctx.req)[SESSION_COOKIE];
      if (token) {
        await destroySession(token);
      }
      return reply.empty(204, { 'Set-Cookie': clearedSessionCookie() });
    },
  });

  endpoint('GET', '/api/me', {
    access: 'member',
    handle: async (ctx) => reply.json(200, meJson(ctx.principal)),
  });
}
