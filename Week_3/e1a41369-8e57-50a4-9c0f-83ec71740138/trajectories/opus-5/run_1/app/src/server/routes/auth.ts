import { query, transaction } from '../db.js';
import { Router, type Ctx } from '../http/core.js';
import { VALIDATION_MESSAGES, fail, failValidation } from '../http/errors.js';
import { USERNAME_PATTERN, createSession, dropSession, hashPassword, passwordMatches } from '../services/auth.js';
import { loadUser, playerJson } from '../services/player.js';
import { publishPlayer } from '../services/notify.js';
import { isValidTimeZone, localDateOf } from '../time.js';
import { runDueCloses } from '../services/close.js';

const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

function credentials(ctx: Ctx): { username: string; password: string } {
  const body = ctx.json();
  const username = typeof body.username === 'string' ? body.username : '';
  const password = typeof body.password === 'string' ? body.password : '';
  return { username, password };
}

export function registerAuthRoutes(router: Router): void {
  router.add('POST', '/api/auth/signup', async (ctx) => {
    const { username, password } = credentials(ctx);
    const taken = await query('select 1 from users where username = $1', [username]);
    if (taken.rowCount === 1) throw fail('username_taken');

    const errors: Record<string, string> = {};
    if (!USERNAME_PATTERN.test(username)) errors.username = VALIDATION_MESSAGES.username;
    if (password.length < 8) errors.password = VALIDATION_MESSAGES.password;
    if (Object.keys(errors).length > 0) throw failValidation(errors);

    const openDate = localDateOf(Date.now(), 0, 'UTC');
    const hash = await hashPassword(password);
    const player = await transaction(async (client) => {
      const created = await client.query<{ id: string }>(
        'insert into users (username, password_hash, open_date) values ($1, $2, $3) returning id',
        [username, hash, openDate],
      );
      const userId = created.rows[0]?.id as string;
      const token = await createSession(client, userId);
      ctx.cookie(token, SESSION_MAX_AGE);
      const user = await loadUser(client, userId);
      if (!user) throw fail('not_found');
      return playerJson(client, user);
    });
    ctx.send(201, player);
  });

  router.add('POST', '/api/auth/login', async (ctx) => {
    const { username, password } = credentials(ctx);
    const found = await query<{ id: string; password_hash: string }>(
      'select id, password_hash from users where username = $1',
      [username],
    );
    const row = found.rows[0];
    if (!row || !(await passwordMatches(password, row.password_hash))) throw fail('invalid_credentials');
    const token = await transaction((client) => createSession(client, row.id));
    ctx.cookie(token, SESSION_MAX_AGE);
    const user = await loadUser({ query }, row.id);
    if (!user) throw fail('not_found');
    ctx.send(200, await playerJson({ query }, user));
  });

  router.add('POST', '/api/auth/logout', async (ctx) => {
    const token = ctx.sessionToken();
    if (token) await dropSession({ query }, token);
    ctx.clearCookie();
    ctx.sendEmpty(204);
  });

  router.add('GET', '/api/me', async (ctx) => {
    const session = ctx.requireUser();
    const user = await loadUser({ query }, session.id);
    if (!user) throw fail('unauthenticated');
    ctx.send(200, await playerJson({ query }, user));
  });

  router.add('PATCH', '/api/settings', async (ctx) => {
    const session = ctx.requireUser();
    const body = ctx.json();
    const errors: Record<string, string> = {};

    let timeZone: string | null = null;
    if (body.timeZone !== undefined) {
      if (typeof body.timeZone === 'string' && isValidTimeZone(body.timeZone)) timeZone = body.timeZone;
      else errors.timeZone = VALIDATION_MESSAGES.timeZone;
    }
    let dayStartHour: number | null = null;
    if (body.dayStartHour !== undefined) {
      const value = body.dayStartHour;
      if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 23) dayStartHour = value;
      else errors.dayStartHour = VALIDATION_MESSAGES.dayStartHour;
    }
    let resting: boolean | null = null;
    if (body.resting !== undefined) {
      if (typeof body.resting === 'boolean') resting = body.resting;
      else errors.resting = 'Rest mode must be true or false.';
    }
    if (Object.keys(errors).length > 0) throw failValidation(errors);

    await transaction(async (client) => {
      if (timeZone !== null) await client.query('update users set time_zone = $2 where id = $1', [session.id, timeZone]);
      if (dayStartHour !== null) {
        await client.query('update users set day_start_hour = $2 where id = $1', [session.id, dayStartHour]);
      }
      if (resting !== null) await client.query('update users set resting = $2 where id = $1', [session.id, resting]);
    });

    // A changed zone or hour may put the open date's close in the past: it closes at once.
    if (timeZone !== null || dayStartHour !== null) await runDueCloses(Date.now());

    const user = await loadUser({ query }, session.id);
    if (!user) throw fail('unauthenticated');
    const player = await playerJson({ query }, user);
    await publishPlayer({ query }, session.id);
    ctx.send(200, player);
  });

  router.add('POST', '/api/notices/:id/ack', async (ctx) => {
    const session = ctx.requireUser();
    const updated = await query('update notices set acked = true where id = $1 and user_id = $2', [
      ctx.param('id'),
      session.id,
    ]);
    if (updated.rowCount === 0) throw fail('not_found');
    ctx.sendEmpty(204);
  });
}
