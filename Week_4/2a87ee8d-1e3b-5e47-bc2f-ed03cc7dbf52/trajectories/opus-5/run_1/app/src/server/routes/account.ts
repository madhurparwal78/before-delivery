import { pool } from '../db/pool.js';
import { AppError, FIELD_MESSAGES } from '../errors.js';
import { verifyPassword } from '../ids.js';
import { healthReport } from '../health.js';
import {
  createFacilitatorSession,
  destroyFacilitatorSession,
  readFacilitatorActor,
  requireFacilitator,
} from '../auth/sessions.js';
import { peekRateLimit, recordRateLimitFailure } from '../http/ratelimit.js';
import { json, noContent, type RouteDefinition } from '../http/pipeline.js';
import { readActivity } from '../activity.js';
import { buildBillingObject, tryRefreshMirror } from '../billing/mirror.js';
import { changePlan, retryPayment } from '../billing/planChange.js';
import { isBillingTerm, isPlanCode } from '../domain/plans.js';

function readString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === 'string' ? value : null;
}

export const accountRoutes: readonly RouteDefinition[] = [
  {
    method: 'GET',
    path: '/api/health',
    auth: 'none',
    handle: async () => json(200, healthReport()),
  },
  {
    method: 'POST',
    path: '/api/session',
    auth: 'none',
    body: 'json',
    handle: async ({ context, body }) => {
      const email = readString(body, 'email');
      const password = readString(body, 'password');
      const fields: Record<string, string> = {};
      if (email === null) fields.email = FIELD_MESSAGES.generic;
      if (password === null) fields.password = FIELD_MESSAGES.generic;
      if (Object.keys(fields).length > 0) throw new AppError('validation', { fields });

      // This endpoint's 429 is checked before the credentials, and only failures are counted.
      const limitKey = `${(email as string).toLowerCase()}|${context.ip}`;
      await peekRateLimit('signin', limitKey, context.nowMs);

      const result = await pool.query<{
        id: string;
        name: string;
        email: string;
        time_zone: string;
        password_hash: string;
      }>('SELECT id, name, email, time_zone, password_hash FROM facilitators WHERE lower(email) = lower($1)', [
        email,
      ]);
      const row = result.rows[0];
      if (!row || !verifyPassword(password as string, row.password_hash)) {
        await recordRateLimitFailure('signin', limitKey, context.nowMs);
        throw new AppError('invalid_credentials');
      }
      await createFacilitatorSession(context, row.id);
      return json(200, {
        facilitator: { name: row.name, email: row.email, timeZone: row.time_zone },
      });
    },
  },
  {
    method: 'GET',
    path: '/api/session',
    auth: 'none',
    handle: async ({ context }) => {
      // This endpoint describes only the facilitator session, whatever participant sessions exist.
      const facilitator = await readFacilitatorActor(context);
      if (facilitator === null) throw new AppError('unauthenticated');
      return json(200, {
        facilitator: {
          name: facilitator.name,
          email: facilitator.email,
          timeZone: facilitator.timeZone,
        },
      });
    },
  },
  {
    method: 'DELETE',
    path: '/api/session',
    auth: 'none',
    handle: async ({ context }) => {
      await destroyFacilitatorSession(context);
      return noContent;
    },
  },
  {
    method: 'GET',
    path: '/api/billing',
    auth: 'session',
    facilitatorOnly: true,
    handle: async ({ actor, nowMs }) => {
      const facilitator = requireFacilitator(actor);
      const refreshed = await tryRefreshMirror(facilitator.facilitatorId, nowMs);
      return json(
        200,
        await buildBillingObject(facilitator.facilitatorId, facilitator.timeZone, nowMs, !refreshed),
      );
    },
  },
  {
    method: 'POST',
    path: '/api/billing/plan',
    auth: 'session',
    body: 'json',
    facilitatorOnly: true,
    operation: true,
    handle: async ({ actor, body, nowMs }) => {
      const facilitator = requireFacilitator(actor);
      const plan = body.plan;
      const term = body.term;
      const fields: Record<string, string> = {};
      if (!isPlanCode(plan)) fields.plan = FIELD_MESSAGES.generic;
      if (!isBillingTerm(term)) fields.term = FIELD_MESSAGES.generic;
      if (Object.keys(fields).length > 0) throw new AppError('validation', { fields });

      const result = await changePlan(
        facilitator.facilitatorId,
        facilitator.timeZone,
        { plan: plan as 'free' | 'studio' | 'agency', term: term as 'monthly' | 'annual' },
        nowMs,
      );
      return json(200, { billing: result.billing, invoice: result.invoice });
    },
  },
  {
    method: 'POST',
    path: '/api/billing/payments',
    auth: 'session',
    body: 'json',
    facilitatorOnly: true,
    operation: true,
    handle: async ({ actor, nowMs }) => {
      const facilitator = requireFacilitator(actor);
      const billing = await retryPayment(facilitator.facilitatorId, facilitator.timeZone, nowMs);
      return json(200, { billing });
    },
  },
  {
    method: 'GET',
    path: '/api/activity',
    auth: 'session',
    facilitatorOnly: true,
    handle: async ({ actor, context }) => {
      const facilitator = requireFacilitator(actor);
      const limitText = context.query.get('limit');
      let limit = 20;
      if (limitText !== null) {
        const parsed = Number.parseInt(limitText, 10);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
          throw new AppError('validation', { fields: { limit: FIELD_MESSAGES.generic } });
        }
        limit = parsed;
      }
      const page = await readActivity(pool, facilitator.facilitatorId, context.query.get('cursor'), limit);
      return json(200, { entries: page.entries, nextCursor: page.nextCursor });
    },
  },
];
