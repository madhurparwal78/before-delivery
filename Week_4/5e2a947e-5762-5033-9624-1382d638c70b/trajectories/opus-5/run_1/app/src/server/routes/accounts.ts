import { randomUUID } from 'node:crypto';
import { copy } from '../../shared/copy.js';
import { ApiError } from '../../shared/errors.js';
import {
  checkLoginRate,
  clearCookieHeader,
  cookieHeader,
  createSession,
  hashPassword,
  recordLoginAttempt,
  requireActor,
  SESSION_COOKIE,
  sessionFor,
  validateCredentials,
  verifyPassword,
} from '../auth.js';
import { isoNow, now } from '../clock.js';
import { db } from '../db.js';
import { readJson, route } from '../http.js';
import { settings } from '../settings.js';

route('POST', '/api/auth/signup', async (ctx) => {
  const body = readJson(ctx);
  validateCredentials(body.username, body.password);
  const username = String(body.username);
  const existing = await db.query('select 1 from users where username = $1', [username]);
  if (existing.rows.length > 0) throw new ApiError('username_taken', copy.usernameTaken);
  const id = randomUUID();
  await db.query('insert into users (id, username, pw_hash, created_at) values ($1, $2, $3, $4)', [
    id,
    username,
    await hashPassword(String(body.password)),
    now(),
  ]);
  const session = await createSession(id);
  ctx.setCookie(cookieHeader(SESSION_COOKIE, session.id, settings.sessionTtlMs));
  return { status: 201, json: { user: { id, username } } };
});

route('POST', '/api/auth/login', async (ctx) => {
  const body = readJson(ctx);
  const username = typeof body.username === 'string' ? body.username : '';
  await checkLoginRate(username);
  await recordLoginAttempt(username);
  const result = await db.query<{ id: string; username: string; pw_hash: string }>(
    'select id, username, pw_hash from users where username = $1',
    [username],
  );
  const user = result.rows[0];
  const password = typeof body.password === 'string' ? body.password : '';
  if (!user || !(await verifyPassword(password, user.pw_hash))) {
    throw new ApiError('bad_credentials', copy.wrongCredentials);
  }
  const session = await createSession(user.id);
  ctx.setCookie(cookieHeader(SESSION_COOKIE, session.id, settings.sessionTtlMs));
  return { status: 200, json: { user: { id: user.id, username: user.username } } };
});

route('POST', '/api/auth/logout', async (ctx) => {
  const id = ctx.cookies[SESSION_COOKIE];
  if (id) await db.query('delete from sessions where id = $1', [id]);
  ctx.setCookie(clearCookieHeader(SESSION_COOKIE));
  return { status: 204 };
});

route('GET', '/api/me', async (ctx) => {
  const actor = await requireActor(ctx);
  const session = await sessionFor(ctx);
  const unread = await db.query<{ total: string }>(
    'select count(*)::text as total from mentions where username = $1 and not read',
    [actor.name],
  );
  return {
    status: 200,
    json: {
      user:
        actor.kind === 'user'
          ? { id: actor.userId, username: actor.name }
          : { id: actor.guestId, username: actor.name, guest: true },
      inbox_unread: Number(unread.rows[0].total),
      server_time: isoNow(),
      session_expires_at: session ? session.expires_at.toISOString() : null,
    },
  };
});
