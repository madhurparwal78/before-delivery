import type { Caller } from '../auth.js';
import { fail } from '../errors.js';
import type { Reply, RequestContext } from '../http.js';
import { settleDue } from '../domain/settle.js';
import * as accounts from './accounts.js';
import * as host from './host.js';
import * as publicApi from './public.js';
import * as rider from './rider.js';
import * as test from './test.js';

type Audience = 'public' | 'session' | 'rider' | 'host';

interface Route {
  method: 'GET' | 'POST';
  pattern: readonly string[];
  audience: Audience;
  settle: boolean;
  run: (ctx: RequestContext, caller: Caller | null) => Promise<Reply> | Reply;
}

function path(pattern: string): readonly string[] {
  return pattern.split('/').filter((part) => part.length > 0);
}

function rider_(
  run: (ctx: RequestContext, caller: Caller) => Promise<Reply> | Reply,
): (ctx: RequestContext, caller: Caller | null) => Promise<Reply> | Reply {
  return (ctx, caller) => run(ctx, caller as Caller);
}

const ROUTES: readonly Route[] = [
  { method: 'GET', pattern: path('/api/health'), audience: 'public', settle: false, run: () => publicApi.health() },
  { method: 'GET', pattern: path('/api/catalogue'), audience: 'public', settle: false, run: () => publicApi.catalogue() },
  { method: 'GET', pattern: path('/api/live/now'), audience: 'public', settle: true, run: (ctx, caller) => publicApi.liveNow(ctx, caller) },
  { method: 'GET', pattern: path('/api/hubs/:hub/slots'), audience: 'public', settle: true, run: (ctx) => publicApi.hubSlots(ctx) },
  { method: 'GET', pattern: path('/api/hubs/:hub/ride-days'), audience: 'public', settle: false, run: (ctx) => publicApi.hubRideDays(ctx) },

  { method: 'POST', pattern: path('/api/auth/register'), audience: 'public', settle: false, run: (ctx) => accounts.register(ctx) },
  { method: 'POST', pattern: path('/api/auth/signin'), audience: 'public', settle: false, run: (ctx) => accounts.signIn(ctx) },
  { method: 'POST', pattern: path('/api/auth/signout'), audience: 'session', settle: false, run: rider_(accounts.signOut) },
  { method: 'GET', pattern: path('/api/me'), audience: 'session', settle: false, run: rider_(accounts.me) },

  { method: 'GET', pattern: path('/api/locks'), audience: 'rider', settle: true, run: rider_(rider.listLocks) },
  { method: 'POST', pattern: path('/api/locks'), audience: 'rider', settle: true, run: rider_(rider.postLock) },
  { method: 'GET', pattern: path('/api/locks/:id'), audience: 'rider', settle: true, run: rider_(rider.readLock) },
  { method: 'POST', pattern: path('/api/locks/:id/release'), audience: 'rider', settle: true, run: rider_(rider.postRelease) },
  { method: 'POST', pattern: path('/api/locks/:id/sheet'), audience: 'rider', settle: true, run: rider_(rider.postSheet) },
  { method: 'GET', pattern: path('/api/locks/:id/sheet'), audience: 'rider', settle: false, run: rider_(rider.getSheet) },
  { method: 'GET', pattern: path('/api/locks/:id/delivery-days'), audience: 'rider', settle: true, run: rider_(rider.getDeliveryDays) },
  { method: 'POST', pattern: path('/api/locks/:id/delivery'), audience: 'rider', settle: true, run: rider_(rider.postDelivery) },
  { method: 'POST', pattern: path('/api/locks/:id/delivery/wait'), audience: 'rider', settle: true, run: rider_(rider.postWait) },
  { method: 'POST', pattern: path('/api/locks/:id/delivery/wait/leave'), audience: 'rider', settle: true, run: rider_(rider.postLeaveLine) },

  { method: 'GET', pattern: path('/api/rides'), audience: 'rider', settle: true, run: rider_(rider.listRides) },
  { method: 'POST', pattern: path('/api/rides'), audience: 'rider', settle: true, run: rider_(rider.postRide) },
  { method: 'GET', pattern: path('/api/rides/:id'), audience: 'rider', settle: true, run: rider_(rider.readRide) },
  { method: 'POST', pattern: path('/api/rides/:id/move'), audience: 'rider', settle: true, run: rider_(rider.postRideMove) },
  { method: 'POST', pattern: path('/api/rides/:id/cancel'), audience: 'rider', settle: true, run: rider_(rider.postRideCancel) },

  { method: 'POST', pattern: path('/api/reminders'), audience: 'rider', settle: false, run: rider_(rider.postReminders) },
  { method: 'GET', pattern: path('/api/notices'), audience: 'rider', settle: true, run: rider_(rider.listNotices) },
  { method: 'GET', pattern: path('/api/notices/:id'), audience: 'rider', settle: true, run: rider_(rider.readNotice) },

  { method: 'GET', pattern: path('/api/hub/day-sheet'), audience: 'host', settle: true, run: rider_(host.daySheet) },
  { method: 'POST', pattern: path('/api/hub/rides/:id/mark'), audience: 'host', settle: true, run: rider_(host.markRideOutcome) },
  { method: 'POST', pattern: path('/api/hub/locks/:id/delivered'), audience: 'host', settle: true, run: rider_(host.markDelivery) },
  { method: 'GET', pattern: path('/api/hub/held-units'), audience: 'host', settle: true, run: rider_(host.heldUnits) },
  { method: 'POST', pattern: path('/api/hub/locks/:id/confirm'), audience: 'host', settle: true, run: rider_(host.confirmUnit) },
  { method: 'POST', pattern: path('/api/hub/locks/:id/refuse'), audience: 'host', settle: true, run: rider_(host.refuseUnit) },
  { method: 'POST', pattern: path('/api/hub/locks/:id/withdraw'), audience: 'host', settle: true, run: rider_(host.withdrawUnit) },
  { method: 'GET', pattern: path('/api/hub/stock'), audience: 'host', settle: true, run: rider_(host.readStock) },
  { method: 'POST', pattern: path('/api/hub/stock-count/start'), audience: 'host', settle: false, run: rider_(host.startCount) },
  { method: 'POST', pattern: path('/api/hub/stock-count/finish'), audience: 'host', settle: false, run: rider_(host.finishCount) },

  { method: 'POST', pattern: path('/api/test/clock'), audience: 'public', settle: false, run: (ctx) => test.setClock(ctx) },
  { method: 'POST', pattern: path('/api/test/reset'), audience: 'public', settle: false, run: () => test.resetAll() },
];

/** The stream is served straight from the server, not through the reply shape. */
export const STREAM_PATTERN = path('/api/live');

export function matchPattern(
  pattern: readonly string[],
  parts: readonly string[],
): Record<string, string> | null {
  if (pattern.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i += 1) {
    const expected = pattern[i] as string;
    const actual = parts[i] as string;
    if (expected.startsWith(':')) params[expected.slice(1)] = decodeURIComponent(actual);
    else if (expected !== actual) return null;
  }
  return params;
}

export interface Matched {
  route: Route;
  params: Record<string, string>;
}

export function findRoute(method: string, parts: readonly string[]): Matched {
  const samePath = ROUTES.filter((route) => matchPattern(route.pattern, parts) !== null);
  if (samePath.length === 0) {
    if (matchPattern(STREAM_PATTERN, parts)) {
      fail('method_not_allowed', { Allow: 'GET' });
    }
    fail('not_found');
  }
  const found = samePath.find((route) => route.method === method);
  if (!found) {
    const allow = [...new Set(samePath.map((route) => route.method))].join(', ');
    fail('method_not_allowed', { Allow: allow });
  }
  return { route: found, params: matchPattern(found.pattern, parts) as Record<string, string> };
}

export function audienceOf(matched: Matched): Audience {
  return matched.route.audience;
}

export async function runRoute(
  matched: Matched,
  ctx: RequestContext,
  caller: Caller | null,
): Promise<Reply> {
  if (matched.route.settle) await settleDue();
  return matched.route.run(ctx, caller);
}
