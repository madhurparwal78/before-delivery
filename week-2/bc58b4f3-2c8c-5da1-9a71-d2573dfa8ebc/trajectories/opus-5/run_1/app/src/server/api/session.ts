import type { SessionUser } from '../../shared/contract.js';
import {
  clearedCookieHeader,
  createSession,
  destroySession,
  sessionCookieHeader,
  type SessionRecord,
} from '../auth/sessions.js';
import { verifyPassword } from '../auth/passwords.js';
import { pool } from '../db/pool.js';
import { findActiveUserByEmail } from '../db/users.js';
import { fail } from '../http/errors.js';
import type { AuthenticatedContext, PublicRoute, Reply, Route } from '../http/router.js';
import { parseJsonBody, stringField } from '../http/validation.js';

function userBody(session: SessionRecord): { user: SessionUser } {
  const { user } = session;
  return {
    user: {
      id: user.id,
      name: user.name,
      role: user.role,
      initials: user.initials,
      org: user.org_code === null || user.org_name === null ? null : { code: user.org_code, name: user.org_name },
    },
  };
}

const signIn: PublicRoute = {
  method: 'POST',
  pattern: '/api/session',
  body: 'json',
  auth: false,
  handler: async (ctx): Promise<Reply> => {
    const body = parseJsonBody(ctx.rawBody);
    const email = stringField(body, 'email');
    const password = stringField(body, 'password');
    const user = await findActiveUserByEmail(pool, email);
    if (user === null || !(await verifyPassword(password, user.password_hash))) {
      fail('invalid_credentials');
    }
    const token = await createSession(user.id);
    const session = { id: token, user, languages: [] };
    return {
      status: 200,
      body: userBody(session),
      headers: { 'set-cookie': sessionCookieHeader(token) },
    };
  },
};

const signOut: Route = {
  method: 'DELETE',
  pattern: '/api/session',
  body: 'none',
  auth: true,
  handler: async (ctx: AuthenticatedContext): Promise<Reply> => {
    await destroySession(ctx.session.id);
    return { status: 204, headers: { 'set-cookie': clearedCookieHeader() } };
  },
};

const me: Route = {
  method: 'GET',
  pattern: '/api/me',
  body: 'none',
  auth: true,
  handler: async (ctx: AuthenticatedContext): Promise<Reply> => ({ status: 200, body: userBody(ctx.session) }),
};

export const sessionRoutes = [signIn, signOut, me];
