import type { SessionUser } from '../../domain/types.js';
import { fail } from '../errors.js';
import type { Route } from '../router.js';
import {
  authenticate,
  clearedCookieHeader,
  createSession,
  deleteSession,
  sessionCookieHeader,
} from '../session.js';
import { stringOf } from '../validation.js';

export function userBody(user: SessionUser): { user: Record<string, unknown> } {
  return {
    user: {
      id: user.id,
      name: user.name,
      role: user.role,
      initials: user.initials,
      org: user.orgCode === null ? null : { code: user.orgCode, name: user.orgName },
    },
  };
}

export const sessionRoutes: Route[] = [
  {
    kind: 'public',
    method: 'POST',
    path: '/api/session',
    body: 'json',
    async handler(ctx) {
      const email = stringOf(ctx.json['email']);
      const password = stringOf(ctx.json['password']);
      if (email === null || password === null) fail('invalid_credentials');
      const user = await authenticate(email, password);
      if (user === null) fail('invalid_credentials');
      const token = await createSession(user.id);
      return {
        status: 200,
        json: userBody(user),
        headers: { 'Set-Cookie': sessionCookieHeader(token) },
      };
    },
  },
  {
    kind: 'session',
    method: 'DELETE',
    path: '/api/session',
    body: 'none',
    async handler(ctx) {
      await deleteSession(ctx.sessionToken);
      return { status: 204, headers: { 'Set-Cookie': clearedCookieHeader() } };
    },
  },
  {
    kind: 'session',
    method: 'GET',
    path: '/api/me',
    body: 'none',
    async handler(ctx) {
      return { status: 200, json: userBody(ctx.user) };
    },
  },
];
