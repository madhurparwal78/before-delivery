import type { ConfigBody, UserBody } from '../../shared/api.js';
import { createUser, endSession, startSession, takeRateSlot, verifyCredentials } from '../auth.js';
import { iso, serverNow } from '../clock.js';
import { config } from '../config.js';
import { pool } from '../db.js';
import { fail } from '../errors.js';
import { noContent, ok, route } from '../http.js';
import { MSG } from '../messages.js';
import { storageReachable } from '../s3.js';

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export function registerMisc(): void {
  route('GET', '/api/health', async () => ok({ status: (await storageReachable()) ? 'ok' : 'unavailable' }), { auth: false });

  route('GET', '/api/config', async () => {
    const body: ConfigBody = {
      server_time: iso(await serverNow()), confirm_window_ms: config.confirmWindowMs, match_limit_ms: config.matchLimitMs,
      swiss_round_ms: config.swissRoundMs, toast_ms: config.toastMs, roster_max_bytes: config.rosterMaxBytes,
      logo_max_bytes: config.logoMaxBytes,
    };
    return ok(body);
  }, { auth: false });

  route('POST', '/api/auth/signup', async (ctx) => {
    const body = ctx.json();
    const user = await createUser(pool, text(body['username']), text(body['password']), await serverNow());
    const reply: UserBody = { user: { username: user.username } };
    return ok(reply, 201, { 'Set-Cookie': await startSession(pool, user.id, await serverNow()) });
  }, { auth: false });

  route('POST', '/api/auth/signin', async (ctx) => {
    const body = ctx.json();
    const username = text(body['username']).toLowerCase();
    if (!(await takeRateSlot('signin', username, config.loginRate, await serverNow()))) fail('rate_limited', MSG.signInRate);
    const user = await verifyCredentials(username, text(body['password']));
    const reply: UserBody = { user: { username: user.username } };
    return ok(reply, 200, { 'Set-Cookie': await startSession(pool, user.id, await serverNow()) });
  }, { auth: false });

  route('POST', '/api/auth/signout', async (ctx) => noContent({ 'Set-Cookie': await endSession(ctx.req) }));

  route('GET', '/api/me', async (ctx) => {
    const reply: UserBody = { user: { username: (ctx.user as { username: string }).username } };
    return ok(reply);
  });
}
