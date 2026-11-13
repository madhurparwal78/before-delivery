import { JSON_BODY_MAX_BYTES } from '../../config.js';
import { pool } from '../../db/pool.js';
import {
  createSession,
  deleteSession,
  findUserByEmail,
  verifyPassword,
  type UserRow,
} from '../../db/users.js';
import type { Me } from '../../domain/types.js';
import { readJsonBody } from '../body.js';
import { clearedSessionCookie, requireUser, sessionCookie, type RequestContext } from '../context.js';
import { invalidCredentials } from '../errors.js';
import { sendJson, sendNoContent } from '../respond.js';

export function meObject(user: UserRow, today: string): Me {
  return {
    id: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
    tz: user.tz,
    coach_code: user.coach_code,
    today,
  };
}

export async function signIn(ctx: RequestContext): Promise<void> {
  const body = await readJsonBody(ctx.req, JSON_BODY_MAX_BYTES);
  const email = typeof body.email === 'string' ? body.email : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const user = await findUserByEmail(pool, email);
  if (!user || !(await verifyPassword(password, user.password_hash))) throw invalidCredentials();
  const sessionId = await createSession(pool, user.id);
  ctx.res.setHeader('set-cookie', sessionCookie(sessionId));
  sendJson(ctx.res, 200, { user: meObject(user, ctx.today) });
}

export async function signOut(ctx: RequestContext): Promise<void> {
  if (ctx.sessionId) await deleteSession(pool, ctx.sessionId);
  ctx.res.setHeader('set-cookie', clearedSessionCookie());
  sendNoContent(ctx.res);
}

export async function me(ctx: RequestContext): Promise<void> {
  sendJson(ctx.res, 200, meObject(requireUser(ctx), ctx.today));
}
