import { jsonResponse, type Member } from '../http/context.js';
import { ApiError } from '../http/errors.js';
import { route, type CompiledRoute } from '../http/router.js';
import {
  SESSION_COOKIE,
  clearedSessionCookie,
  createSession,
  endSession,
  memberOf,
  sessionCookie,
  verifyPassword,
} from '../http/sessions.js';
import { isoSeconds } from '../../shared/brussels.js';
import { HOME_ROUTES } from '../../shared/routes.js';
import { readString } from '../http/validate.js';

export function memberJson(member: Member): unknown {
  return { id: member.id, name: member.name, email: member.email, role: member.role };
}

export function memberWithCreatedAtJson(member: Member): unknown {
  return { ...(memberJson(member) as object), createdAt: isoSeconds(member.createdAt) };
}

function sessionBody(member: Member): unknown {
  return { member: memberJson(member), homeRoute: HOME_ROUTES[member.role] };
}

export const sessionRoutes: CompiledRoute[] = [
  route({
    method: 'POST',
    path: '/api/session',
    access: 'public',
    handle: async (ctx) => {
      const body = ctx.json();
      const email = (readString(body, 'email') ?? '').trim().toLowerCase();
      const password = readString(body, 'password') ?? '';
      const { rows } = await ctx.app.db.query<{
        id: string;
        name: string;
        email: string;
        role: string;
        created_at: string;
        removed_at: string | null;
        password_hash: string;
      }>(
        `SELECT id, name, email, role, created_at, removed_at, password_hash
           FROM members WHERE email_lower = $1 AND removed_at IS NULL`,
        [email],
      );
      const row = rows[0];
      const wrong = new ApiError(401, 'invalid_credentials', 'That email and password do not match.');
      if (row === undefined || !verifyPassword(password, row.password_hash)) throw wrong;

      const member = memberOf(row);
      const token = await createSession(
        ctx.app.db,
        member.id,
        ctx.now,
        ctx.app.config.sessionSeconds,
      );
      return jsonResponse(200, sessionBody(member), { 'Set-Cookie': sessionCookie(token) });
    },
  }),

  route({
    method: 'GET',
    path: '/api/session',
    access: 'staff',
    handle: async (ctx) => jsonResponse(200, sessionBody(ctx.signedInMember())),
  }),

  route({
    method: 'DELETE',
    path: '/api/session',
    access: 'staff',
    handle: async (ctx) => {
      const token = ctx.cookies[SESSION_COOKIE];
      if (token !== undefined) await endSession(ctx.app.db, token, ctx.now);
      return { kind: 'empty', status: 204, headers: { 'Set-Cookie': clearedSessionCookie() } };
    },
  }),
];
