import { newId, databaseReady, db } from '../db.js';
import { clockBody, setServerNow } from '../domain/clock.js';
import { config } from '../config.js';
import { authed, type Ctx, type Route } from '../http/api.js';
import { clearSessionCookie, setSessionCookie } from '../http/boundary.js';
import {
  ApiError,
  directoryUnavailable,
  forbidden,
  notFound,
  validation,
} from '../http/errors.js';
import {
  BadCredentials,
  DirectoryDown,
  authenticatePerson,
  searchPeople,
} from '../services/directory.js';
import { serviceStatus } from '../services/health.js';
import { kindFilter, rememberPerson } from '../domain/people.js';
import { runSweep } from '../sweep.js';
import { broadcastClock } from '../events.js';

export const systemRoutes: Route[] = [
  {
    method: 'GET',
    pattern: '/api/health',
    open: true,
    handler: async () =>
      (await databaseReady())
        ? { status: 200, body: { status: 'ok' } }
        : { status: 503, body: { status: 'starting' } },
  },
  {
    method: 'GET',
    pattern: '/api/status',
    open: true,
    handler: async () => ({ status: 200, body: serviceStatus() }),
  },
  {
    method: 'GET',
    pattern: '/api/clock',
    open: true,
    handler: async () => ({ status: 200, body: clockBody() }),
  },
  {
    method: 'PUT',
    pattern: '/api/clock',
    open: true,
    handler: async (ctx: Ctx) => {
      if (!config.clockControl) throw notFound();
      const now = ctx.body.now;
      if (typeof now !== 'string' || Number.isNaN(Date.parse(now))) {
        throw validation({ now: 'Send an ISO 8601 instant with an offset.' });
      }
      setServerNow(new Date(now));
      await runSweep();
      broadcastClock();
      return { status: 200, body: clockBody() };
    },
  },
  {
    method: 'POST',
    pattern: '/api/session',
    open: true,
    handler: async (ctx: Ctx) => {
      const email = ctx.body.email;
      const password = ctx.body.password;
      if (typeof email !== 'string' || typeof password !== 'string') {
        throw new ApiError(401, 'invalid_credentials');
      }
      try {
        const person = await authenticatePerson(email, password);
        await rememberPerson(person);
        const id = newId() + newId();
        await db.query('INSERT INTO sessions (id, person_id) VALUES ($1,$2)', [id, person.id]);
        setSessionCookie(ctx.res, id);
        return { status: 200, body: { person } };
      } catch (error) {
        if (error instanceof BadCredentials) throw new ApiError(401, 'invalid_credentials');
        if (error instanceof DirectoryDown) throw directoryUnavailable();
        throw error;
      }
    },
  },
  {
    method: 'GET',
    pattern: '/api/session',
    handler: async (ctx: Ctx) => ({ status: 200, body: { person: authed(ctx).person } }),
  },
  {
    method: 'DELETE',
    pattern: '/api/session',
    handler: async (ctx: Ctx) => {
      const { sessionId } = authed(ctx);
      await db.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
      clearSessionCookie(ctx.res);
      return { status: 204 };
    },
  },
  {
    method: 'GET',
    pattern: '/api/people',
    handler: async (ctx: Ctx) => {
      const { person } = authed(ctx);
      if (person.kind !== 'staff') throw forbidden();
      const query = ctx.url.searchParams.get('q') ?? '';
      if (query.length < 1 || query.length > 100) {
        throw validation({ q: 'Search for 1 to 100 characters.' });
      }
      const kind = kindFilter(ctx.url.searchParams.get('kind'));
      try {
        const people = await searchPeople(query, kind);
        for (const found of people) await rememberPerson(found);
        return { status: 200, body: { people } };
      } catch (error) {
        if (error instanceof DirectoryDown) throw directoryUnavailable();
        throw error;
      }
    },
  },
];
