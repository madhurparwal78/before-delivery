import { nowIso, nowMs } from '../clock.js';
import {
  countRate,
  createSession,
  hashPassword,
  membershipsOf,
  userRowOf,
  verifyPassword,
} from '../auth.js';
import { one, query } from '../db.js';
import { settings } from '../env.js';
import { fail } from '../errors.js';
import { clearedCookie, route, sessionCookie } from '../http.js';
import { currentSeq, subscribeSpace } from '../live.js';
import { storageAnswers } from '../storage.js';
import { isKnownZone } from '../domain/tz.js';

const USERNAME = /^[a-z0-9_]{3,24}$/;

function usernameError(): string {
  return 'Use 3 to 24 characters: a-z, 0-9 or _.';
}

export async function createUserWithSpace(
  username: string,
  password: string,
  timeZone = 'UTC',
): Promise<{ id: number; spaceId: number }> {
  const hash = await hashPassword(password);
  const user = await one<{ id: number }>(
    `insert into users (username, password_hash, time_zone) values ($1, $2, $3) returning id`,
    [username, hash, timeZone],
  );
  const userId = Number(user?.id);
  const space = await one<{ id: number }>(
    `insert into spaces (slug, name) values ($1, $2)
     on conflict (slug) do update set name = spaces.name returning id`,
    [username, username],
  );
  const spaceId = Number(space?.id);
  await query(
    `insert into members (space_id, user_id, role) values ($1, $2, 'admin')
     on conflict (space_id, user_id) do nothing`,
    [spaceId, userId],
  );
  await query(`update users set current_space_id = $2 where id = $1`, [userId, spaceId]);
  return { id: userId, spaceId };
}

export function registerPlatformRoutes(): void {
  route({
    method: 'GET',
    path: '/api/health',
    auth: 'none',
    body: 'none',
    handler: async () => {
      let database = true;
      try {
        await query('select 1');
      } catch {
        database = false;
      }
      const storage = await storageAnswers();
      return { status: 200, body: { status: database && storage ? 'ok' : 'unavailable' } };
    },
  });

  route({
    method: 'GET',
    path: '/api/config',
    auth: 'none',
    body: 'none',
    handler: async () => ({
      status: 200,
      body: {
        grading: settings.grading,
        settings: {
          page_size: settings.pageSize,
          tail_buffer: settings.tailBuffer,
          query_max_len: settings.queryMaxLen,
          query_max_depth: settings.queryMaxDepth,
          upload_max_bytes: settings.uploadMaxBytes,
          sse_heartbeat_ms: settings.sseHeartbeatMs,
        },
      },
    }),
  });

  route({
    method: 'GET',
    path: '/api/time',
    auth: 'none',
    body: 'none',
    handler: async () => ({ status: 200, body: { now: nowIso(), now_ms: nowMs() } }),
  });

  route({
    method: 'POST',
    path: '/api/signup',
    auth: 'none',
    body: 'json',
    handler: async (ctx) => {
      const username = String(ctx.body.username ?? '').toLowerCase();
      const password = String(ctx.body.password ?? '');
      const fields: Record<string, string> = {};
      if (!USERNAME.test(username)) fields.username = usernameError();
      if (password.length < 8) fields.password = 'Use at least 8 characters.';
      const taken = await one(`select id from users where username = $1`, [username]);
      if (taken) throw fail.nameTaken({ username: 'That username is taken.' });
      if (Object.keys(fields).length > 0) throw fail.invalid(fields);
      const created = await createUserWithSpace(username, password);
      const sessionId = await createSession(created.id);
      ctx.setCookie = sessionCookie(sessionId);
      return { status: 201, body: { username, space: username } };
    },
  });

  route({
    method: 'POST',
    path: '/api/signin',
    auth: 'none',
    body: 'json',
    handler: async (ctx) => {
      const username = String(ctx.body.username ?? '').toLowerCase();
      const password = String(ctx.body.password ?? '');
      countRate('login', username);
      const row = await one(`select * from users where username = $1`, [username]);
      if (!row) throw fail.badCredentials();
      const user = userRowOf(row);
      const ok = await verifyPassword(password, String(row.password_hash));
      if (!ok) throw fail.badCredentials();
      const sessionId = await createSession(user.id);
      ctx.setCookie = sessionCookie(sessionId);
      const memberships = await membershipsOf(user.id);
      const current =
        memberships.find((membership) => membership.spaceId === user.currentSpaceId) ?? memberships[0];
      return { status: 200, body: { username: user.username, space: current?.slug ?? username } };
    },
  });

  route({
    method: 'POST',
    path: '/api/signout',
    auth: 'none',
    body: 'none',
    handler: async (ctx) => {
      if (ctx.caller.kind === 'session' && ctx.caller.sessionId) {
        await query(`delete from sessions where id = $1`, [ctx.caller.sessionId]);
      }
      ctx.setCookie = clearedCookie();
      return { status: 204 };
    },
  });

  route({
    method: 'GET',
    path: '/api/me',
    auth: 'session',
    body: 'none',
    handler: async (ctx) => {
      if (ctx.caller.kind !== 'session') throw fail.unauthenticated();
      const user = ctx.caller.user;
      const memberships = await membershipsOf(user.id);
      const current = memberships.find((membership) => membership.spaceId === user.currentSpaceId) ?? memberships[0];
      if (!current) throw fail.notFound();
      return {
        status: 200,
        body: {
          username: user.username,
          time_zone: user.timeZone,
          space: { slug: current.slug, name: current.name, role: current.role },
          spaces: memberships.map((membership) => ({
            slug: membership.slug,
            name: membership.name,
            role: membership.role,
          })),
          seq: await currentSeq(current.spaceId),
        },
      };
    },
  });

  route({
    method: 'PATCH',
    path: '/api/me',
    auth: 'session',
    body: 'json',
    handler: async (ctx) => {
      if (ctx.caller.kind !== 'session') throw fail.unauthenticated();
      const user = ctx.caller.user;
      if (ctx.body.space !== undefined) {
        const slug = String(ctx.body.space);
        const membership = (await membershipsOf(user.id)).find((item) => item.slug === slug);
        if (!membership) throw fail.notFound();
        await query(`update users set current_space_id = $2 where id = $1`, [user.id, membership.spaceId]);
        user.currentSpaceId = membership.spaceId;
      }
      if (ctx.body.time_zone !== undefined) {
        const zone = String(ctx.body.time_zone);
        if (!isKnownZone(zone)) throw fail.invalid({ time_zone: `Unknown time zone ${zone}.` });
        await query(`update users set time_zone = $2 where id = $1`, [user.id, zone]);
        user.timeZone = zone;
      }
      const memberships = await membershipsOf(user.id);
      const current = memberships.find((membership) => membership.spaceId === user.currentSpaceId) ?? memberships[0];
      return {
        status: 200,
        body: {
          username: user.username,
          time_zone: user.timeZone,
          space: { slug: current.slug, name: current.name, role: current.role },
          spaces: memberships.map((membership) => ({
            slug: membership.slug,
            name: membership.name,
            role: membership.role,
          })),
          seq: await currentSeq(current.spaceId),
        },
      };
    },
  });

  route({
    method: 'GET',
    path: '/api/events',
    auth: 'session',
    space: true,
    body: 'none',
    handler: async (ctx) => {
      subscribeSpace(ctx.space.id, ctx.res);
      return { status: 200, handled: true };
    },
  });
}
