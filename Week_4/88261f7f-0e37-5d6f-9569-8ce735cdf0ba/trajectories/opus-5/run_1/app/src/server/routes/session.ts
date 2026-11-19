import { one, pool } from '../db';
import { errorTexts, failure } from '../http/errors';
import { Router } from '../http/router';
import {
  clearedCookieHeader,
  createSession,
  deleteSession,
  passwordMatches,
  sessionCookieHeader,
} from '../http/session';
import { isRole } from '../domain/roles';
import { signedInUser, textField } from './support';

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  hotel_id: string;
  password_hash: string;
}

export function registerSessionRoutes(router: Router): void {
  router.add({
    method: 'POST',
    pattern: '/api/session',
    access: 'public',
    bodyMode: 'json',
    handler: async (ctx) => {
      const email = textField(ctx.body, 'email').trim().toLowerCase();
      const password = textField(ctx.body, 'password');
      const row = await one<UserRow>(
        pool,
        'select id, email, name, role, hotel_id, password_hash from users where lower(email) = $1',
        [email],
      );
      if (!row || !isRole(row.role) || !passwordMatches(password, row.password_hash)) {
        throw failure(401, errorTexts.badCredentials);
      }
      const sessionId = await createSession(pool, row.id);
      return {
        status: 200,
        json: {
          user: {
            id: row.id,
            email: row.email,
            name: row.name,
            role: row.role,
            hotelId: row.hotel_id,
          },
        },
        headers: { 'set-cookie': sessionCookieHeader(sessionId) },
      };
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/session',
    access: 'signedIn',
    bodyMode: 'none',
    handler: async (ctx) => {
      const user = signedInUser(ctx);
      return {
        status: 200,
        json: {
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            hotelId: user.hotelId,
          },
        },
      };
    },
  });

  router.add({
    method: 'DELETE',
    pattern: '/api/session',
    access: 'signedIn',
    bodyMode: 'none',
    handler: async (ctx) => {
      await deleteSession(pool, signedInUser(ctx).sessionId);
      return { status: 204, headers: { 'set-cookie': clearedCookieHeader() } };
    },
  });
}
