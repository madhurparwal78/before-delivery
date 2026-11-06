import { COOP_ZONE, displayCoopTime, isoInstant } from '../../domain/time.js';
import { GENERIC_FIELD_MESSAGE, parseBody, stringField } from '../../domain/validate.js';
import { serverNow, setServerNow } from '../clock.js';
import { config } from '../config.js';
import { sessionBody, signIn, signOut } from '../data/people.js';
import { apiError, notFound, validationFailed } from '../http/errors.js';
import {
  clearedSessionCookie,
  jsonBody,
  requireSession,
  sessionCookie,
  type Reply,
  type Route,
} from '../http/router.js';

function clockBody(now: Date): Record<string, unknown> {
  return { now: isoInstant(now), now_display: displayCoopTime(now), zone: COOP_ZONE };
}

export const sessionRoutes: Route[] = [
  {
    method: 'GET',
    pattern: '/api/health',
    anonymous: true,
    async handle(): Promise<Reply> {
      return { status: 200, json: { status: 'ok' } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/session',
    anonymous: true,
    async handle(ctx): Promise<Reply> {
      const parsed = parseBody<{ email: string; password: string }>(jsonBody(ctx), {
        email: stringField(GENERIC_FIELD_MESSAGE, () => null),
        password: stringField(GENERIC_FIELD_MESSAGE, () => null),
      });
      if (!parsed.ok) throw validationFailed(parsed.fields);
      const result = await signIn(parsed.value.email, parsed.value.password);
      if (!result) {
        throw apiError(401, 'invalid_credentials', 'That email and password do not match.');
      }
      return {
        status: 200,
        json: await sessionBody(result.person),
        headers: { 'set-cookie': sessionCookie(result.sessionId) },
      };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/session',
    anonymous: true,
    async handle(ctx): Promise<Reply> {
      if (ctx.sessionId) await signOut(ctx.sessionId);
      return { status: 204, headers: { 'set-cookie': clearedSessionCookie() } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/me',
    async handle(ctx): Promise<Reply> {
      return { status: 200, json: await sessionBody(requireSession(ctx)) };
    },
  },
  {
    method: 'GET',
    pattern: '/api/clock',
    anonymous: true,
    async handle(): Promise<Reply> {
      return { status: 200, json: clockBody(await serverNow()) };
    },
  },
  {
    method: 'PUT',
    pattern: '/api/clock',
    anonymous: true,
    async handle(ctx): Promise<Reply> {
      if (!config.clockControl) throw notFound();
      const parsed = parseBody<{ now: string }>(jsonBody(ctx), {
        now: stringField(GENERIC_FIELD_MESSAGE, (value) =>
          Number.isNaN(new Date(value).getTime()) ? GENERIC_FIELD_MESSAGE : null,
        ),
      });
      if (!parsed.ok) throw validationFailed(parsed.fields);
      return { status: 200, json: clockBody(await setServerNow(new Date(parsed.value.now))) };
    },
  },
];
