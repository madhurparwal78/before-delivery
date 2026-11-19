import { query } from '../db/pool.ts';
import { ApiError, validation } from '../errors.ts';
import { unwritableKeyErrors, WRITABLE_FIELDS } from '../domain/writable.ts';
import { sendEmpty, sendJson } from '../http/respond.ts';
import type { Route } from '../http/router.ts';
import { createSession, destroySession, passwordMatches, sessionTokenFromCookie } from '../services/auth.ts';

export const consoleSessionRoutes: readonly Route[] = [
  {
    path: '/api/console/session',
    method: 'POST',
    handler: async ({ response, json }) => {
      const errors = unwritableKeyErrors(json, WRITABLE_FIELDS.session);
      if (typeof json.email !== 'string') errors.email = 'Must be text.';
      if (typeof json.password !== 'string') errors.password = 'Must be text.';
      if (Object.keys(errors).length > 0) throw validation(errors);

      const result = await query<{ email: string; password_hash: string }>(
        `SELECT email, password_hash FROM operators WHERE lower(email) = lower($1)`,
        [json.email as string],
      );
      const operator = result.rows[0];
      if (operator === undefined || !passwordMatches(json.password as string, operator.password_hash)) {
        throw new ApiError(401, 'invalid_credentials', 'That email and password do not match.');
      }
      const token = await createSession(operator.email);
      sendJson(
        response,
        200,
        { operator: { email: operator.email } },
        { 'set-cookie': `earshot_session=${token}; Path=/; HttpOnly; SameSite=Lax` },
      );
    },
  },
  {
    path: '/api/console/session',
    method: 'DELETE',
    requiresSession: true,
    handler: async ({ request, response }) => {
      const token = sessionTokenFromCookie(request.headers.cookie);
      if (token !== null) await destroySession(token);
      sendEmpty(response, 204, {
        'set-cookie': 'earshot_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
      });
    },
  },
];
