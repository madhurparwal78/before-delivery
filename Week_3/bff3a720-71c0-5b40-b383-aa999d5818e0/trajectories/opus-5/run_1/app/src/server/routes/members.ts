import { now } from '../clock.js';
import { db } from '../db.js';
import { isoZoned } from '../domain/time.js';
import { errors } from '../errors.js';
import { CITIES, distanceList, isCity } from '../../shared/cities.js';
import { priceRange } from '../domain/pricing.js';
import { routeKm } from '../domain/route.js';
import { loadMember, serialiseMember } from '../model.js';
import type { Ctx, Reply, Router } from '../http.js';

async function me(ctx: Ctx): Promise<Reply> {
  const member = ctx.requireMember();
  const record = await loadMember(db, member.id);
  if (!record) throw errors.notFound();
  return { status: 200, body: await serialiseMember(db, record, { self: true }) };
}

async function member(ctx: Ctx): Promise<Reply> {
  ctx.requireMember();
  const record = await loadMember(db, ctx.param('id'));
  if (!record) throw errors.notFound();
  return { status: 200, body: await serialiseMember(db, record) };
}

async function cities(): Promise<Reply> {
  return {
    status: 200,
    body: { cities: [...CITIES], distances: distanceList(), server_now: isoZoned(now()) },
  };
}

async function priceRangeRoute(ctx: Ctx): Promise<Reply> {
  const raw = ctx.query('stops') ?? '';
  const stops = raw.split(',').map((part) => part.trim());
  if (stops.length < 2 || !stops.every(isCity) || new Set(stops).size !== stops.length) {
    throw errors.validationFailed({ stops: 'List two or more different towns.' });
  }
  const km = routeKm(stops);
  const range = priceRange(km);
  return {
    status: 200,
    body: { route_km: km, low_cents: range.lowCents, high_cents: range.highCents },
  };
}

export function registerMemberRoutes(router: Router): void {
  router.add({ method: 'GET', pattern: '/api/me', kind: 'plain', auth: 'member', handler: me });
  router.add({
    method: 'GET',
    pattern: '/api/members/:id',
    kind: 'plain',
    auth: 'member',
    handler: member,
  });
  router.add({
    method: 'GET',
    pattern: '/api/cities',
    kind: 'plain',
    auth: 'none',
    handler: cities,
  });
  router.add({
    method: 'GET',
    pattern: '/api/price-range',
    kind: 'plain',
    auth: 'none',
    handler: priceRangeRoute,
  });
}
