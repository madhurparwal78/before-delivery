import {
  createSession,
  endOtherSessions,
  endSession,
  findPersonByEmail,
  hashPassword,
  SESSION_COOKIE,
  verifyPassword,
} from '../auth.js';
import { db } from '../db.js';
import { config } from '../env.js';
import { ApiError, fail, FIELD_MESSAGES } from '../errors.js';
import { body, requireAccount, route, sendEmpty, sendJson, type Ctx, type Route } from '../http.js';

function accountBody(name: string, email: string, isOwner: boolean): unknown {
  return { user: { name, email, is_owner: isOwner } };
}

export const sessionRoutes: Route[] = [
  route(
    'POST',
    '/api/session',
    async (ctx: Ctx) => {
      const raw = body(ctx);
      const email = raw.email;
      const password = raw.password;
      const fields: Record<string, string> = {};
      if (typeof email !== 'string' || email.trim() === '') fields.email = 'Enter your email.';
      if (typeof password !== 'string' || password === '') fields.password = 'Enter your password.';
      if (Object.keys(fields).length > 0) throw new ApiError('validation', { fields });

      const person = await findPersonByEmail(db, email as string);
      if (person === null || !(await verifyPassword(password as string, person.passwordHash))) {
        fail('invalid_credentials');
      }
      const sessionId = await createSession(person.id);
      ctx.res.setHeader(
        'set-cookie',
        `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${
          config.sessionIdleMinutes * 60
        }`,
      );
      sendJson(ctx.res, 200, accountBody(person.name, person.email, person.isOwner));
    },
    true,
  ),
  route('DELETE', '/api/session', async (ctx: Ctx) => {
    if (ctx.account !== null) await endSession(ctx.account.session);
    ctx.res.setHeader('set-cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    sendEmpty(ctx.res, 204);
  }),
  route('GET', '/api/me', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    sendJson(
      ctx.res,
      200,
      accountBody(account.person.name, account.person.email, account.person.isOwner),
    );
  }),
  route('POST', '/api/me/password', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const raw = body(ctx);
    const current = raw.current_password;
    const next = raw.new_password;
    const fields: Record<string, string> = {};
    if (typeof next !== 'string' || next.length < 10) {
      fields.new_password = FIELD_MESSAGES.newPassword;
    } else if (next.length > 200) {
      fields.new_password = 'New password must be 200 characters or fewer.';
    }
    const person = await findPersonByEmail(db, account.person.email);
    if (
      typeof current !== 'string' ||
      person === null ||
      !(await verifyPassword(current, person.passwordHash))
    ) {
      fields.current_password = "That isn't your current password.";
    }
    if (Object.keys(fields).length > 0) throw new ApiError('validation', { fields });

    await db.query(`update people set password_hash = $2 where id = $1`, [
      account.person.id,
      await hashPassword(next as string),
    ]);
    await endOtherSessions(account.person.id, account.session);
    sendJson(ctx.res, 200, { ok: true });
  }),
];
