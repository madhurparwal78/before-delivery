import { withTransaction, withClient } from '../db.js';
import { empty, json, route, type Ctx } from '../http.js';
import { invalidCredentials } from '../errors.js';
import { SESSION_COOKIE, endSession, signIn } from '../auth.js';
import { practice, practiceToday } from '../domain/practice.js';
import { query } from '../db.js';

const ALL_ROLES = ['farrier', 'apprentice', 'owner', 'barn_manager'] as const;

function sessionCookie(sessionId: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax`;
}

function clearedCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function registerSessionRoutes(): void {
  route({
    method: 'POST',
    path: '/api/session',
    bodyKind: 'json',
    rate: 'sign_in',
    handler: async (ctx: Ctx) => {
      const body = ctx.body<{ email?: unknown; password?: unknown }>();
      const email = typeof body.email === 'string' ? body.email : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const signedIn = await withTransaction((db) => signIn(db, email, password));
      if (signedIn === null) throw invalidCredentials();
      return json(
        200,
        {
          user: {
            id: signedIn.caller.userId,
            name: signedIn.caller.name,
            email: signedIn.caller.email,
            role: signedIn.caller.role,
          },
        },
        { 'set-cookie': sessionCookie(signedIn.sessionId) },
      );
    },
  });

  route({
    method: 'DELETE',
    path: '/api/session',
    roles: ALL_ROLES,
    handler: async (ctx: Ctx) => {
      if (ctx.caller.sessionId !== null) {
        const sessionId = ctx.caller.sessionId;
        await withTransaction((db) => endSession(db, sessionId));
      }
      return empty(204, { 'set-cookie': clearedCookie() });
    },
  });

  route({
    method: 'GET',
    path: '/api/me',
    roles: ALL_ROLES,
    tokenAccess: 'read_only',
    handler: async (ctx: Ctx) =>
      json(200, {
        id: ctx.caller.userId,
        name: ctx.caller.name,
        email: ctx.caller.email,
        role: ctx.caller.role,
      }),
  });

  route({
    method: 'GET',
    path: '/api/practice',
    roles: ALL_ROLES,
    tokenAccess: 'read_only',
    handler: async () => {
      const body = await withClient(async (db) => {
        const info = await practice(db);
        return { name: info.name, time_zone: info.timeZone, today: await practiceToday(db) };
      });
      return json(200, body);
    },
  });

  route({
    method: 'GET',
    path: '/api/barns',
    roles: ['farrier', 'apprentice'],
    tokenAccess: 'read_only',
    handler: async () => {
      const rows = await withClient((db) =>
        query<{ id: string; name: string; trip_fee_cents: number }>(
          db,
          'SELECT id, name, trip_fee_cents FROM barns ORDER BY name',
        ),
      );
      return json(200, rows);
    },
  });
}
