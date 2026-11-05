import type { Route } from '../http/router';
import { SESSION_COOKIE, signedInUser } from '../http/router';
import * as errors from '../http/errors';
import { ping } from '../db/pool';
import {
  authenticate,
  createSession,
  dropSession,
  toUser,
} from '../repo/users';
import { listClays } from '../repo/catalog';

function cookieHeader(sessionId: string | null): string {
  const base = `${SESSION_COOKIE}=${sessionId ?? ''}; Path=/; HttpOnly; SameSite=Lax`;
  return sessionId ? base : `${base}; Max-Age=0`;
}

export const authRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/health',
    roles: 'anyone',
    handler: async () =>
      (await ping()) ? { status: 200, body: { status: 'ok' } } : { status: 503, body: { status: 'starting' } },
  },
  {
    method: 'POST',
    path: '/api/session',
    roles: 'anyone',
    handler: async (ctx) => {
      const email = typeof ctx.body.email === 'string' ? ctx.body.email : '';
      const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
      const row = await authenticate(email, password);
      if (!row) throw errors.badCredentials();
      const sessionId = await createSession(row.id);
      return {
        status: 200,
        body: { user: toUser(row) },
        headers: { 'Set-Cookie': cookieHeader(sessionId) },
      };
    },
  },
  {
    method: 'DELETE',
    path: '/api/session',
    roles: 'signed-in',
    handler: async (ctx) => {
      const cookie = /(?:^|;\s*)shelfmark_session=([^;]+)/.exec(ctx.req.get('cookie') ?? '');
      if (cookie?.[1]) await dropSession(cookie[1]);
      return { status: 204, headers: { 'Set-Cookie': cookieHeader(null) } };
    },
  },
  {
    method: 'GET',
    path: '/api/me',
    roles: 'signed-in',
    handler: async (ctx) => ({ status: 200, body: toUser(signedInUser(ctx)) }),
  },
  {
    method: 'GET',
    path: '/api/clays',
    roles: 'signed-in',
    handler: async () => ({ status: 200, body: await listClays() }),
  },
];
