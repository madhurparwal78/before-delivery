import {
  clearedSessionCookie,
  createSession,
  destroySession,
  personByEmail,
  sessionCookie,
  SESSION_COOKIE,
} from '../auth';
import { pool } from '../db/pool';
import { bodyField, sendJson, sendNoContent } from '../http/context';
import { invalidCredentials } from '../http/errors';
import { requirePerson } from '../http/guards';
import type { Route } from '../http/router';

function personJson(person: { id: string; name: string; email: string; orgRole: string }) {
  return { id: person.id, name: person.name, email: person.email, org_role: person.orgRole };
}

export const sessionRoutes: readonly Route[] = [
  {
    method: 'GET',
    path: '/api/health',
    handler: (context) => sendJson(context, 200, { status: 'ok' }),
  },
  {
    method: 'POST',
    path: '/api/session',
    handler: async (context) => {
      const email = bodyField(context.body, 'email');
      const password = bodyField(context.body, 'password');
      if (typeof email !== 'string' || typeof password !== 'string') throw invalidCredentials();
      const person = await personByEmail(pool, email, password);
      if (person === null) throw invalidCredentials();
      const sessionId = await createSession(pool, person.id);
      sendJson(context, 200, { person: personJson(person) }, {
        'set-cookie': sessionCookie(sessionId),
      });
    },
  },
  {
    method: 'DELETE',
    path: '/api/session',
    handler: async (context) => {
      await destroySession(pool, context.cookies[SESSION_COOKIE]);
      sendNoContent(context, { 'set-cookie': clearedSessionCookie() });
    },
  },
  {
    method: 'GET',
    path: '/api/me',
    handler: async (context) => {
      const person = await requirePerson(pool, context);
      sendJson(context, 200, { person: personJson(person) });
    },
  },
];
