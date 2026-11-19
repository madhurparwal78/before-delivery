import { now } from '../clock.js';
import { copy } from '../copy.js';
import { ApiError } from '../errors.js';
import { query } from '../db.js';
import { readBody, optionalText, text } from '../fields.js';
import {
  authenticate,
  clearSignInFailures,
  clearedCookie,
  lockStateFor,
  lockedRefusal,
  recordSignInFailure,
  sessionCookie,
  startSession,
} from '../auth.js';
import { TIME_ZONE, officeDate, officeOffset, officeTimeOfDay } from '../officeTime.js';
import { checkPassword } from '../services/keycloak.js';
import { landingRoute } from '../domain/landing.js';
import { loadPersonByHandle, personJson, scopeIds, travelWindows } from '../domain/people.js';
import { visibleVaultIds } from '../domain/visibility.js';
import type { PublicRoute, Route } from '../http.js';

export const signInLockoutGuard = async (handle: string | null): Promise<void> => {
  if (handle === null) return;
  const lock = await lockStateFor(handle);
  if (lock.locked && lock.reopensAt !== null) throw lockedRefusal(lock.reopensAt);
};

export const publicSessionRoutes: PublicRoute[] = [
  {
    method: 'GET',
    path: '/api/clock',
    open: true,
    handler: async () => {
      const at = now();
      return {
        status: 200,
        body: {
          now: at.toISOString(),
          office_date: officeDate(at),
          office_time: officeTimeOfDay(at),
          offset: officeOffset(at),
          time_zone: TIME_ZONE,
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/api/health',
    open: true,
    handler: async () => ({ status: 200, body: { status: 'ok' } }),
  },
  {
    method: 'POST',
    path: '/api/sessions',
    open: true,
    handler: async (ctx) => {
      const body = readBody(ctx.body, {
        username: { kind: 'string' },
        password: { kind: 'string' },
        next: { kind: 'string', optional: true },
      });
      const handle = text(body, 'username');
      const password = text(body, 'password');
      const wanted = optionalText(body, 'next') ?? null;

      const outcome = await checkPassword(handle, password);
      if (outcome === 'bad_credentials') {
        await recordSignInFailure(handle);
        throw new ApiError(401, 'bad_credentials', copy.badCredentials);
      }
      const person = await loadPersonByHandle(handle);
      if (outcome === 'account_disabled' || person === null || person.left_at !== null) {
        if (person === null) {
          await recordSignInFailure(handle);
          throw new ApiError(401, 'bad_credentials', copy.badCredentials);
        }
        throw new ApiError(401, 'account_disabled', copy.accountDisabled);
      }
      await clearSignInFailures(handle);
      if (!person.has_signed_in) await query('update people set has_signed_in = true where id = $1', [person.id]);

      const session = await startSession(person.id);
      const at = now();
      const visible = await visibleVaultIds(person, at);
      ctx.setCookie(sessionCookie(session.id, session.ends_at));
      return {
        status: 201,
        body: {
          person: personJson(
            { ...person, has_signed_in: true },
            await scopeIds(person.id),
            await travelWindows(person.id),
            at,
          ),
          session_ends_at: session.ends_at.toISOString(),
          landing: landingRoute({ next: wanted, role: person.role, visibleVaultIds: visible }),
        },
      };
    },
  },
  {
    method: 'DELETE',
    path: '/api/sessions',
    open: true,
    handler: async (ctx) => {
      const cookieValue = ctx.header('cookie');
      if (cookieValue !== null) {
        const outcome = await authenticate(readSessionId(cookieValue));
        if ('caller' in outcome) {
          await query('update sessions set signed_out_at = $2 where id = $1', [outcome.caller.session.id, now()]);
        }
      }
      ctx.setCookie(clearedCookie());
      return { status: 204 };
    },
  },
];

function readSessionId(cookieHeader: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === 'lockset_session') return part.slice(index + 1).trim();
  }
  return null;
}

export const sessionRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/me',
    handler: async (ctx) => {
      const at = now();
      const { person, session } = ctx.caller;
      return {
        status: 200,
        body: {
          person: personJson(person, await scopeIds(person.id), await travelWindows(person.id), at),
          session_ends_at: session.ends_at.toISOString(),
        },
      };
    },
  },
];
