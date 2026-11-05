import type { ApiResult, RequestContext } from './context.ts';
import * as identity from '../api/identity.ts';
import * as cycles from '../api/cycles.ts';
import * as lines from '../api/lines.ts';
import * as documents from '../api/documents.ts';
import * as bags from '../api/bags.ts';
import * as reports from '../api/reports.ts';
import * as money from '../api/money.ts';

export type IdempotencyMode = 'required' | 'optional' | 'none';

export interface Route {
  method: string;
  segments: string[];
  handler: (ctx: RequestContext) => ApiResult | Promise<ApiResult>;
  auth: 'public' | 'session';
  body: 'json' | 'raw' | 'none';
  idempotency: IdempotencyMode | ((ctx: RequestContext) => 'required' | 'optional');
}

function route(
  method: string,
  pattern: string,
  handler: Route['handler'],
  options: Partial<Pick<Route, 'auth' | 'body' | 'idempotency'>> = {},
): Route {
  return {
    method,
    segments: pattern.split('/').filter((segment) => segment.length > 0),
    handler,
    auth: options.auth ?? 'session',
    body: options.body ?? 'none',
    idempotency: options.idempotency ?? 'none',
  };
}

export const routes: Route[] = [
  route('GET', '/api/health', identity.health, { auth: 'public' }),
  route('POST', '/api/session', identity.signIn, { auth: 'public', body: 'json' }),
  route('DELETE', '/api/session', identity.signOut),
  route('GET', '/api/me', identity.me),
  route('GET', '/api/club', identity.club),
  route('GET', '/api/catalog', identity.catalog),
  route('GET', '/api/payments/status', identity.paymentsStatus),
  route('GET', '/api/cycles', cycles.listCycles),
  route('POST', '/api/cycles', cycles.createCycle, { body: 'json' }),
  route('GET', '/api/cycles/:cycleId', cycles.getCycle),
  route('PATCH', '/api/cycles/:cycleId', cycles.patchCycle, { body: 'json', idempotency: 'optional' }),
  route('POST', '/api/cycles/:cycleId/transitions', cycles.transition, {
    body: 'json',
    idempotency: cycles.transitionsIdempotencyMode,
  }),
  route('PUT', '/api/cycles/:cycleId/lines/:productId/pledge', lines.putPledge, {
    body: 'json',
    idempotency: 'required',
  }),
  route('DELETE', '/api/cycles/:cycleId/lines/:productId/pledge', lines.deletePledge, {
    idempotency: 'required',
  }),
  route('GET', '/api/cycles/:cycleId/lines/:productId/shares', lines.getShares),
  route('POST', '/api/cycles/:cycleId/lines/:productId/resolution', lines.postResolution, {
    body: 'json',
    idempotency: 'optional',
  }),
  route('POST', '/api/cycles/:cycleId/lines/:productId/shorts', lines.postShort, {
    body: 'json',
    idempotency: 'required',
  }),
  route('PUT', '/api/cycles/:cycleId/documents/:kind', documents.putDocument, { body: 'raw' }),
  route('GET', '/api/cycles/:cycleId/documents', documents.listDocuments),
  route('GET', '/api/cycles/:cycleId/documents/:kind', documents.getDocument),
  route('GET', '/api/cycles/:cycleId/bags', bags.listBags),
  route('PUT', '/api/cycles/:cycleId/bags/:householdCode/items/:productId', bags.putBagItem, {
    body: 'json',
    idempotency: 'optional',
  }),
  route('POST', '/api/cycles/:cycleId/bags/:householdCode/flags', bags.postFlag, {
    body: 'json',
    idempotency: 'optional',
  }),
  route('GET', '/api/cycles/:cycleId/flags', lines.listFlags),
  route('GET', '/api/cycles/:cycleId/daily', reports.dailyPledges),
  route('GET', '/api/cycles/:cycleId/receipts', reports.listReceipts),
  route('POST', '/api/topups', money.postTopup, { body: 'json', idempotency: 'required' }),
  route('GET', '/api/topups', money.listTopups),
  route('GET', '/api/households/:householdCode/ledger', money.getLedger),
];

export interface Match {
  route: Route;
  params: Record<string, string>;
}

function matchSegments(route: Route, parts: string[]): Record<string, string> | null {
  if (route.segments.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < parts.length; index += 1) {
    const expected = route.segments[index]!;
    const actual = parts[index]!;
    if (expected.startsWith(':')) params[expected.slice(1)] = decodeURIComponent(actual);
    else if (expected !== actual) return null;
  }
  return params;
}

export function matchRoute(method: string, pathname: string): Match | null {
  const parts = pathname.split('/').filter((segment) => segment.length > 0);
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    const params = matchSegments(candidate, parts);
    if (params) return { route: candidate, params };
  }
  return null;
}

