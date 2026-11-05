import { Router, type RequestContext, validationError } from '../http/types.js';
import { ApiError } from '../errors.js';
import { sessionUser, createSession, destroySession, findUserByEmail } from '../db/session-store.js';
import { verifyPassword, isEmail, charCount } from '../domain/ids.js';
import { serializeCookie } from '../http/cookies.js';
import { bodyOf } from '../http/body.js';
import { sendJson, type Role } from '../http/respond.js';

export const SESSION_COOKIE = 'ts_session';

export interface User {
  id: number;
  email: string;
  role: Role;
}

export async function currentUser(ctx: RequestContext): Promise<User | null> {
  return sessionUser(ctx.cookies[SESSION_COOKIE]);
}

export async function requireUser(ctx: RequestContext): Promise<User> {
  const user = await sessionUser(ctx.cookies[SESSION_COOKIE]);
  if (user === null) throw new ApiError(401, 'unauthenticated');
  return user;
}

export async function requireRole(ctx: RequestContext, roles: Role[]): Promise<User> {
  const user = await requireUser(ctx);
  if (!roles.includes(user.role)) throw new ApiError(403, 'forbidden');
  return user;
}

export function landingOf(role: string): string {
  if (role === 'author') return '/studio';
  if (role === 'editor') return '/studio/review';
  if (role === 'contributor') return '/contribute';
  if (role === 'staff') return '/staff';
  return '/catalogue';
}

export function registerSessionRoutes(router: Router): void {
  router.add({
    method: 'POST',
    pattern: '/api/session',
    allowedParams: [],
    json: true,
    handler: async ctx => {
      const body = bodyOf(ctx);
      const email = typeof body['email'] === 'string' ? body['email'] : '';
      const password = typeof body['password'] === 'string' ? body['password'] : '';
      const fields: Record<string, string> = {};
      if (!isEmail(email)) fields['email'] = 'Enter a valid email address.';
      if (charCount(password) < 8 || charCount(password) > 64) fields['password'] = 'Use 8 to 64 characters.';
      if (Object.keys(fields).length > 0) throw validationError(fields);
      const user = await findUserByEmail(email);
      if (user === null || !verifyPassword(password, user.password_hash)) {
        throw new ApiError(401, 'invalid_credentials');
      }
      const role = user.role as Role;
      const session = await createSession(user.id);
      ctx.res.setHeader(
        'Set-Cookie',
        serializeCookie(SESSION_COOKIE, session, { httpOnly: true, sameSite: 'Lax', maxAge: 60 * 60 * 24 * 14 }),
      );
      sendJson(ctx, 200, { role, landing: landingOf(role) });
    },
  });
  router.add({
    method: 'GET',
    pattern: '/api/session',
    allowedParams: [],
    handler: async ctx => {
      const user = await sessionUser(ctx.cookies[SESSION_COOKIE]);
      if (user === null) throw new ApiError(401, 'unauthenticated');
      sendJson(ctx, 200, { role: user.role, email: user.email, landing: landingOf(user.role) });
    },
  });
  router.add({
    method: 'DELETE',
    pattern: '/api/session',
    allowedParams: [],
    handler: async ctx => {
      const sessionId = ctx.cookies[SESSION_COOKIE];
      if (sessionId !== undefined) await destroySession(sessionId);
      ctx.res.setHeader(
        'Set-Cookie',
        serializeCookie(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'Lax', maxAge: 0 }),
      );
      sendJson(ctx, 204, null);
    },
  });
}
