import { randomUUID } from 'node:crypto';
import { FIELD_COPY } from '../../shared/errors.js';
import type { AppContext } from '../core/context.js';
import { verifyPassword } from '../core/passwords.js';
import { presentUser } from '../core/present.js';
import { signPayload } from '../core/signing.js';
import { fail, failValidation } from '../http/apiError.js';
import type { Caller, HandlerResult } from '../http/context.js';
import { SESSION_COOKIE } from '../http/pipeline.js';
import { publicRoute, sessionRoute, type Route } from '../http/routes.js';
import { readString } from './shared.js';

function cookie(value: string, maxAge: number | null): string {
  const parts = [`${SESSION_COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAge !== null) parts.push(`Max-Age=${maxAge}`);
  return parts.join('; ');
}

export function sessionRoutes(app: AppContext): Route[] {
  return [
    publicRoute('GET', '/api/health', 'none', async (): Promise<HandlerResult> => ({
      kind: 'json',
      status: 200,
      value: { status: 'ok' },
    })),

    publicRoute('POST', '/api/session', 'json', async (context): Promise<HandlerResult> => {
      const email = readString(context.json, 'email');
      const password = readString(context.json, 'password');
      const fields: Record<string, string> = {};
      if (email === null || email.trim() === '') fields['email'] = FIELD_COPY.required;
      if (password === null || password === '') fields['password'] = FIELD_COPY.required;
      if (Object.keys(fields).length > 0) throw failValidation(fields);

      const found = await app.pool.query<{
        id: string;
        name: string;
        role: string;
        email: string;
        password_hash: string;
      }>(`select id, name, role, email, password_hash from person where lower(email) = lower($1)`, [
        (email as string).trim(),
      ]);
      const person = found.rows[0];
      if (person === undefined || !(await verifyPassword(password as string, person.password_hash))) {
        throw fail('bad_credentials');
      }

      const sessionId = randomUUID();
      await app.pool.query(`insert into web_session (id, person_id) values ($1, $2)`, [
        sessionId,
        person.id,
      ]);
      const caller: Caller = {
        id: person.id,
        name: person.name,
        role: person.role as Caller['role'],
        email: person.email,
        sessionId,
      };
      return {
        kind: 'json',
        status: 200,
        value: { user: presentUser(caller) },
        cookie: cookie(signPayload(app.secret, sessionId), null),
      };
    }),

    sessionRoute({
      method: 'GET',
      pattern: '/api/session',
      handle: async (context): Promise<HandlerResult> => ({
        kind: 'json',
        status: 200,
        value: { user: presentUser(context.caller) },
      }),
    }),

    sessionRoute({
      method: 'DELETE',
      pattern: '/api/session',
      handle: async (context): Promise<HandlerResult> => {
        await app.pool.query(`delete from web_session where id = $1`, [context.caller.sessionId]);
        return { kind: 'empty', status: 204, cookie: cookie('', 0) };
      },
    }),

    sessionRoute({
      method: 'GET',
      pattern: '/api/members',
      roles: ['volunteer', 'founder'],
      handle: async (): Promise<HandlerResult> => {
        const result = await app.pool.query<{ id: string; name: string }>(
          `select id, name from person where role = 'member' order by name asc`,
        );
        return { kind: 'json', status: 200, value: { members: result.rows } };
      },
    }),
  ];
}
