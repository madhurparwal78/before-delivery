import { ApiError } from '../../domain/api-error.js';
import { codePoints } from '../../domain/validate.js';
import { allowance } from '../allowance.js';
import { query } from '../db.js';
import {
  clearedSessionCookie,
  jsonBody,
  requireOwner,
  requireSigned,
  sendEmpty,
  sendJson,
  sessionCookie,
  type Route,
} from '../http.js';
import { closeSession } from '../live.js';
import { personBySession, publicPerson, signIn, signOut } from '../repo/people.js';
import { mailIsUp, waitingCount } from '../services/mail.js';
import { queueIsUp } from '../services/queue.js';
import { storageIsUp } from '../services/storage.js';
import type { OutboxItem, ServiceStatus } from '../../shared/types.js';

export const sessionRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/health',
    auth: 'public',
    handle: async (context) => {
      sendJson(context.response, 200, { status: 'ok' });
    },
  },
  {
    method: 'POST',
    path: '/api/session',
    auth: 'public',
    body: 'json',
    handle: async (context) => {
      const body = jsonBody(context);
      const email = typeof body.email === 'string' ? body.email : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const signed = await signIn(email, password);
      if (signed === null) throw ApiError.of('bad_credentials', undefined);
      sendJson(context.response, 200, { person: publicPerson(signed.person) }, { 'set-cookie': sessionCookie(signed.sessionId) });
    },
  },
  {
    method: 'GET',
    path: '/api/session',
    auth: 'session',
    handle: async (context) => {
      const signed = requireSigned(context);
      sendJson(context.response, 200, { person: signed.person, is_owner: signed.is_owner });
    },
  },
  {
    method: 'DELETE',
    path: '/api/session',
    auth: 'session',
    handle: async (context) => {
      const signed = requireSigned(context);
      await signOut(signed.session_id);
      closeSession(signed.session_id);
      sendEmpty(context.response, 204, { 'set-cookie': clearedSessionCookie() });
    },
  },
  {
    method: 'GET',
    path: '/api/status',
    auth: 'session',
    handle: async (context) => {
      requireOwner(context);
      const status: ServiceStatus = {
        storage: storageIsUp() ? 'up' : 'down',
        queue: queueIsUp() ? 'up' : 'down',
        mail: mailIsUp() ? 'up' : 'down',
      };
      sendJson(context.response, 200, { ...status, waiting: await waitingCount() });
    },
  },
  {
    method: 'GET',
    path: '/api/allowance',
    auth: 'session',
    handle: async (context) => {
      requireSigned(context);
      sendJson(context.response, 200, await allowance());
    },
  },
  {
    method: 'GET',
    path: '/api/profile',
    auth: 'session',
    handle: async (context) => {
      const signed = requireSigned(context);
      const person = await personBySession(signed.session_id);
      if (person === null) throw ApiError.of('unauthenticated', undefined);
      sendJson(context.response, 200, { name: person.name, availability: person.availability });
    },
  },
  {
    method: 'PUT',
    path: '/api/profile',
    auth: 'session',
    body: 'json',
    handle: async (context) => {
      const signed = requireOwner(context);
      const body = jsonBody(context);
      const availability = typeof body.availability === 'string' ? body.availability : null;
      if (availability === null || codePoints(availability) > 140) {
        throw ApiError.validation({ availability: 'That value is not allowed here.' });
      }
      await query(`update people set availability = $2 where id = $1`, [signed.person.id, availability]);
      sendJson(context.response, 200, { name: signed.person.name, availability });
    },
  },
  {
    method: 'GET',
    path: '/api/outbox',
    auth: 'session',
    handle: async (context) => {
      requireOwner(context);
      const rows = await query<{
        id: string;
        to_addr: string;
        subject: string;
        state: 'waiting' | 'sent';
        attempts: number;
        created_at: Date;
        sent_at: Date | null;
      }>(`select id, to_addr, subject, state, attempts, created_at, sent_at from outbox order by created_at`);
      const items: OutboxItem[] = rows.map((row) => ({
        id: row.id,
        to: row.to_addr,
        subject: row.subject,
        state: row.state,
        attempts: row.attempts,
        created_at: row.created_at.toISOString(),
        sent_at: row.sent_at === null ? null : row.sent_at.toISOString(),
      }));
      sendJson(context.response, 200, { items });
    },
  },
];
