import {
  clearedCookie,
  createSession,
  hashPassword,
  sessionCookie,
  userByName,
  validateCredentials,
  verifyPassword,
} from './auth';
import { config } from './config';
import { db } from './db';
import { errors } from './errors';
import { Ctx, Reply, noteRate, route, text } from './http';
import { tx } from './live';

route(
  'POST',
  '/api/users',
  async (ctx: Ctx): Promise<Reply> => {
    const username = text(ctx.body, 'username');
    const password = text(ctx.body, 'password');
    const failure = validateCredentials(username, password);
    if (failure !== null) throw failure;
    const name = (username ?? '').toLowerCase();
    const existing = await db.one<{ id: string }>('select id from users where username = $1', [name]);
    if (existing !== null) throw errors.conflict('username_taken', 'That username is taken.');
    const user = await tx(async (t) => {
      const row = await t.sql.one<{ id: string; username: string; time_zone: string }>(
        `insert into users (username, password_hash, time_zone) values ($1, $2, 'UTC')
         returning id, username, time_zone`,
        [name, hashPassword(password ?? '')],
      );
      const token = await createSession(t.sql, Number(row?.id));
      return { row, token };
    });
    return {
      status: 201,
      body: {
        user: { id: Number(user.row?.id), username: user.row?.username, time_zone: user.row?.time_zone },
      },
      headers: { 'set-cookie': sessionCookie(user.token) },
    };
  },
  { auth: false },
);

route(
  'POST',
  '/api/session',
  async (ctx: Ctx): Promise<Reply> => {
    const username = (text(ctx.body, 'username') ?? '').toLowerCase();
    const password = text(ctx.body, 'password') ?? '';
    await noteRate(`login:${username}`, config.loginRate);
    const row = await db.one<{ id: string; username: string; time_zone: string; password_hash: string; can_sign_in: boolean }>(
      'select id, username, time_zone, password_hash, can_sign_in from users where username = $1',
      [username],
    );
    if (row === null || !row.can_sign_in || !verifyPassword(password, row.password_hash)) {
      throw errors.badCredentials();
    }
    const token = await tx(async (t) => createSession(t.sql, Number(row.id)));
    return {
      status: 200,
      body: { user: { id: Number(row.id), username: row.username, time_zone: row.time_zone } },
      headers: { 'set-cookie': sessionCookie(token) },
    };
  },
  { auth: false },
);

route('DELETE', '/api/session', async (ctx: Ctx): Promise<Reply> => {
  await db.query('delete from sessions where user_id = $1', [ctx.user.id]);
  return { status: 204, body: null, headers: { 'set-cookie': clearedCookie() } };
});

route('GET', '/api/me', async (ctx: Ctx): Promise<Reply> => {
  return { status: 200, body: { user: ctx.user } };
});

route(
  'PATCH',
  '/api/me',
  async (ctx: Ctx): Promise<Reply> => {
    const zone = text(ctx.body, 'time_zone');
    if (zone === null) throw errors.validation('time_zone', `Unknown time zone ${String(ctx.body.time_zone)}.`);
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date());
    } catch {
      throw errors.validation('time_zone', `Unknown time zone ${zone}.`);
    }
    await db.query('update users set time_zone = $2 where id = $1', [ctx.user.id, zone]);
    const user = await userByName(db, ctx.user.username);
    return { status: 200, body: { user } };
  },
  { write: true },
);

route(
  'GET',
  '/api/config',
  async (): Promise<Reply> => {
    return { status: 200, body: { toast_ms: config.toastMs, sse_heartbeat_ms: config.sseHeartbeatMs } };
  },
  { auth: false },
);
