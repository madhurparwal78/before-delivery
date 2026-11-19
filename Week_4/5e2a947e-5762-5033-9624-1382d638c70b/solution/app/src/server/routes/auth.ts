import { ApiError } from '../../shared/errors.ts';
import {
  SESSION_COOKIE,
  clearCookie,
  createSession,
  createUser,
  endSession,
  findUser,
  noteLoginAttempt,
  requireAccount,
  sessionCookie,
  validateCredentials,
  verifyPassword,
} from '../auth.ts';
import { serverIso, toIso } from '../clock.ts';
import { config } from '../config.ts';
import { database, query } from '../db.ts';
import { bodyObject, json, route } from '../http.ts';

async function signedIn(user: { id: string; username: string }, status: number) {
  const session = await createSession(user.id);
  return json(status, { user: { id: user.id, username: user.username } }, { 'set-cookie': sessionCookie(SESSION_COOKIE, session.token, config.sessionTtlMs) });
}

route('POST', '/api/auth/signup', {
  body: 'json',
  stages: {
    validate: (ctx) => {
      const body = bodyObject(ctx);
      const fields = validateCredentials(body.username, body.password);
      if (Object.keys(fields).length > 0) throw new ApiError('invalid', 'Check the highlighted fields.', { fields });
    },
  },
  handle: async (ctx) => {
    const body = bodyObject(ctx);
    return signedIn(await createUser(String(body.username), String(body.password)), 201);
  },
});

route('POST', '/api/auth/login', {
  body: 'json',
  stages: {
    rate: (ctx) => {
      const body = bodyObject(ctx);
      if (typeof body.username === 'string') noteLoginAttempt(body.username);
    },
  },
  handle: async (ctx) => {
    const body = bodyObject(ctx);
    const user = typeof body.username === 'string' ? await findUser(body.username) : null;
    const ok = user !== null && typeof body.password === 'string' && (await verifyPassword(body.password, user.password_hash));
    if (!user || !ok) throw new ApiError('bad_credentials', 'Wrong username or password.');
    return signedIn(user, 200);
  },
});

route('POST', '/api/auth/logout', {
  stages: {},
  handle: async (ctx) => {
    const token = ctx.cookies[SESSION_COOKIE];
    if (token) await endSession(token);
    return { status: 204, headers: { 'set-cookie': clearCookie(SESSION_COOKIE) } };
  },
});

route('GET', '/api/me', {
  stages: { authenticate: async (ctx) => void (await requireAccount(ctx)) },
  handle: async (ctx) => {
    const principal = ctx.principal;
    const rows = await query<{ n: string }>(database(), 'SELECT count(*) AS n FROM mentions WHERE user_id = $1 AND NOT read', [principal?.id ?? '']);
    return json(200, {
      user: { id: principal?.id ?? '', username: principal?.name ?? '' },
      inbox_unread: Number(rows[0]?.n ?? 0),
      server_time: serverIso(),
      session_expires_at: toIso(principal?.expiresAt ?? 0),
    });
  },
});

