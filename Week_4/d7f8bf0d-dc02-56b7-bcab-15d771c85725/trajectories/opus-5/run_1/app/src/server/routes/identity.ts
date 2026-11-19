import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { errors } from '../errors.js';
import { sessionCookie, parseCookies } from '../http.js';
import type { Route } from '../router.js';
import {
  endAuthSession,
  findUserByEmail,
  membershipsOf,
  SESSION_COOKIE,
  startAuthSession,
  verifyPassword,
} from '../services/auth.js';

export const identityRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/auth/sign-in',
    auth: 'open',
    handle: async (ctx) => {
      const email = ctx.text('email', 320);
      const password = ctx.text('password', 200);
      const user = await findUserByEmail(email);
      if (!user || !(await verifyPassword(password, user.password_hash))) {
        throw errors.invalidCredentials();
      }
      const sessionId = await startAuthSession(user.id);
      return {
        status: 200,
        body: {
          user: { id: user.id, email: user.email, display_name: user.display_name },
          idle_seconds: config.sessionIdleSeconds,
        },
        cookie: sessionCookie(SESSION_COOKIE, sessionId, config.sessionIdleSeconds),
      };
    },
  },
  {
    method: 'POST',
    path: '/api/auth/sign-out',
    auth: 'open',
    handle: async (ctx) => {
      const sessionId = parseCookies(ctx.req.headers.cookie).get(SESSION_COOKIE);
      if (sessionId) await endAuthSession(sessionId);
      return { status: 204, body: null, cookie: sessionCookie(SESSION_COOKIE, '', 0) };
    },
  },
  {
    method: 'GET',
    path: '/api/me',
    auth: 'user',
    handle: async (ctx) => ({
      status: 200,
      body: {
        user: {
          id: ctx.person.id,
          email: ctx.person.email,
          display_name: ctx.person.display_name,
          walkthrough_done: ctx.person.walkthrough_done,
        },
        memberships: await membershipsOf(ctx.person.id),
      },
    }),
  },
  {
    method: 'POST',
    path: '/api/me/walkthrough',
    auth: 'user',
    handle: async (ctx) => {
      const done = ctx.flag('done');
      await pool.query(`update users set walkthrough_done = $2 where id = $1`, [
        ctx.person.id,
        done,
      ]);
      return { status: 200, body: { walkthrough_done: done } };
    },
  },
];
