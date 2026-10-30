import type { Role, User } from '../../../shared/types';
import { pool } from '../../db';
import { invalidCredentials } from '../../errors';
import { createSession, destroySession, verifyPassword } from '../../repo/session';
import { Router, requirePrincipal } from '../kernel';

export function registerSessionRoutes(router: Router): void {
  router.add({
    method: 'GET',
    pattern: '/api/health',
    access: 'public',
    handle: async () => ({ status: 200, json: { status: 'ok' } }),
  });

  router.add({
    method: 'POST',
    pattern: '/api/session',
    access: 'public',
    handle: async (ctx) => {
      const email = typeof ctx.body.email === 'string' ? ctx.body.email.trim().toLowerCase() : '';
      const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
      const { rows } = await pool.query<{
        id: string;
        name: string;
        email: string;
        role: Role;
        password_hash: string;
      }>('SELECT id, name, email, role, password_hash FROM members WHERE lower(email) = $1', [email]);
      const member = rows[0];
      if (!member || !verifyPassword(password, member.password_hash)) throw invalidCredentials();
      const token = await createSession(member.id);
      const user: User = { id: member.id, name: member.name, email: member.email, role: member.role };
      return { status: 200, json: { user }, setSession: token };
    },
  });

  router.add({
    method: 'DELETE',
    pattern: '/api/session',
    access: 'member',
    handle: async (ctx) => {
      if (ctx.sessionToken) await destroySession(ctx.sessionToken);
      return { status: 204, setSession: null };
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/me',
    access: 'member',
    handle: async (ctx) => {
      const principal = requirePrincipal(ctx);
      const user: User = {
        id: principal.memberId,
        name: principal.name,
        email: principal.email,
        role: principal.role,
      };
      return {
        status: 200,
        json: {
          user,
          workspace: {
            id: principal.workspaceId,
            name: principal.workspaceName,
            timeZone: principal.timeZone,
          },
        },
      };
    },
  });
}
