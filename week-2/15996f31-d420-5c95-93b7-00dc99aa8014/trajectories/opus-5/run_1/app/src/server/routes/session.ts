import type { RuleSet } from '../../shared/api-types';
import { pool } from '../db';
import { loadRuleSets } from '../data/orders';
import { passwordMatches } from '../data/passwords';
import {
  createSession,
  deleteSession,
  findUserByEmail,
  listGrowers,
} from '../data/users';
import { apiError } from '../http/errors';
import { SESSION_COOKIE, readCookie, requireActor, requireRole, type Route } from '../http/router';
import { databaseReady } from '../readiness';
import { trimmedString } from '../http/validate';

function sessionCookie(value: string, maxAge: number | null): string {
  const parts = [`${SESSION_COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAge !== null) parts.push(`Max-Age=${maxAge}`);
  return parts.join('; ');
}

export const sessionRoutes: readonly Route[] = [
  {
    method: 'GET',
    path: '/api/health',
    body: 'none',
    auth: 'public',
    handle: async () =>
      databaseReady()
        ? { status: 200, json: { status: 'ok' } }
        : { status: 503, json: { status: 'starting' } },
  },
  {
    method: 'POST',
    path: '/api/session',
    body: 'json',
    auth: 'public',
    handle: async (ctx) => {
      const email = trimmedString(ctx.body.json.email) ?? '';
      const password = typeof ctx.body.json.password === 'string' ? ctx.body.json.password : '';
      const user = await findUserByEmail(pool, email);
      if (user === null || !passwordMatches(password, user.passwordHash)) {
        throw apiError.invalidCredentials();
      }
      const sessionId = await createSession(pool, user.id);
      return {
        status: 200,
        json: { user: { id: user.id, name: user.personName, role: user.role } },
        setCookie: sessionCookie(sessionId, null),
      };
    },
  },
  {
    method: 'DELETE',
    path: '/api/session',
    body: 'none',
    auth: 'session',
    handle: async (ctx) => {
      requireActor(ctx);
      const sessionId = readCookie(ctx.headers, SESSION_COOKIE);
      if (sessionId !== null) await deleteSession(pool, sessionId);
      return { status: 204, setCookie: sessionCookie('', 0) };
    },
  },
  {
    method: 'GET',
    path: '/api/me',
    body: 'none',
    auth: 'session',
    handle: async (ctx) => {
      const actor = requireActor(ctx);
      return {
        status: 200,
        json: { user: { id: actor.id, name: actor.personName, role: actor.role } },
      };
    },
  },
  {
    method: 'GET',
    path: '/api/growers',
    body: 'none',
    auth: 'session',
    handle: async (ctx) => {
      requireRole(ctx, 'broker');
      return { status: 200, json: await listGrowers(pool) };
    },
  },
  {
    method: 'GET',
    path: '/api/rule-sets',
    body: 'none',
    auth: 'session',
    handle: async (ctx) => {
      requireRole(ctx, 'broker');
      const ruleSets = await loadRuleSets(pool);
      const json: RuleSet[] = ruleSets.map((ruleSet) => ({
        id: ruleSet.id,
        name: ruleSet.name,
        effective_from: ruleSet.effectiveFrom,
        thresholds: {
          reduced: ruleSet.thresholdsTenths.reduced / 10,
          standard: ruleSet.thresholdsTenths.standard / 10,
          bonus: ruleSet.thresholdsTenths.bonus / 10,
        },
        price_per_hive_cents: ruleSet.pricePerHiveCents,
        commission_bps: ruleSet.commissionBps,
        deposit_per_hive_cents: ruleSet.depositPerHiveCents,
      }));
      return { status: 200, json };
    },
  },
];
