import { Call, bodyHash, clearCookie, cookie, rateLimit, sendJson, sendText } from './http';
import { ApiError, conflict, forbidden, notFound, unauthorized, validation } from './errors';
import { config } from './config';
import { nowIso, nowMs } from './clock';
import { one, query } from './db';
import { addStream, send, sendToUser } from './events';
import { currencyTable, isCurrency } from './currency';
import { CURS, Cur, LANGS, Lang } from '../shared/types';
import { convertTotal } from '../shared/money';
import {
  createSession,
  hashPassword,
  loadUser,
  storePreferences,
  usernameValid,
  verifyPassword,
} from './auth';
import { completedStays, tierOf } from './loyalty';
import {
  loadDestination,
  loadDestinations,
  loadInventory,
  loadProperty,
  propertiesOfDestination,
} from './inventory';
import { normaliseSearch } from './searchlink';
import { runSearch } from './search';
import { recommend, placeOverride, leftOverStay } from './allocation';
import { makeStayContext, planRate } from './pricing';
import { checkArrivalDay, checkDepartureDay } from './restrictions';
import { propertyScore } from './loyalty';
import { addDays, datesBetween, diffDays, isDate, localDate } from './zone';
import { createQuote, createHold, loadQuoteRow, ownsQuote, releaseHold, serialiseQuote } from './quotes';
import {
  Viewer,
  applyChange,
  bookingObject,
  canSeeBooking,
  cancelRooms,
  cancellationPreview,
  changePreview,
  createBookingFromHold,
  findBooking,
  grantAccess,
  loadBookingRow,
  markNoShow,
} from './bookings';
import { moderateReview, pendingReviews, reviewWindow, submitReview } from './reviews';
import { calendar, patchNights } from './manage';
import { applyImport, parseImport, previewChanges, sha256Of } from './imports';
import { reservationRows, reservationsCsv, statementCsv, statementFor, statementMonths } from './statements';
import { getObject, putObject, storageReachable } from './storage';
import { handleGrading } from './grading';

function requireVisitor(call: Call): string {
  if (!call.ctx.visitorId) throw unauthorized('no_visitor');
  return call.ctx.visitorId;
}

function requireUser(call: Call): { username: string; role: string; manages: string[] } {
  if (!call.ctx.user) throw unauthorized();
  return call.ctx.user;
}

function viewerOf(call: Call): Viewer {
  return {
    visitorId: call.ctx.visitorId,
    username: call.ctx.user?.username ?? null,
    manages: call.ctx.user?.manages ?? [],
    role: call.ctx.user?.role ?? null,
  };
}

async function callerTier(call: Call): Promise<ReturnType<typeof tierOf>> {
  const stays = await completedStays(call.ctx.user?.username ?? null, nowMs());
  return tierOf(stays);
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export async function handleApi(call: Call): Promise<void> {
  const path = call.url.pathname;
  const method = call.method;
  const cookies = call.setCookies;

  if (path.startsWith('/api/grading/')) {
    await handleGrading(call);
    return;
  }

  if (method === 'GET' && path === '/api/health') {
    const { dbReady } = await import('./db');
    if (!dbReady()) {
      sendJson(call.res, 503, { status: 'starting' }, {}, cookies);
      return;
    }
    const storage = await storageReachable();
    sendJson(call.res, 200, { status: storage ? 'ok' : 'unavailable' }, {}, cookies);
    return;
  }

  if (method === 'GET' && path === '/api/time') {
    sendJson(call.res, 200, { now: nowIso() }, {}, cookies);
    return;
  }

  if (method === 'GET' && path === '/api/currency') {
    sendJson(call.res, 200, await currencyTable(), {}, cookies);
    return;
  }

  if (method === 'GET' && path === '/api/events') {
    const headers: Record<string, string | string[]> = {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    };
    if (cookies.length > 0) headers['set-cookie'] = cookies;
    call.res.writeHead(200, headers);
    const stream = addStream(call.res, call.ctx.visitorId, call.ctx.user?.username ?? null);
    send(stream, 'clock', { now: nowIso() });
    const owner = call.ctx.user?.username ?? null;
    const holds = await query<{ id: string; state: string }>(
      `select id, state from holds where state <> 'live'
         and ((username is not null and username = $1) or (username is null and visitor = $2))`,
      [owner, call.ctx.visitorId],
    );
    for (const hold of holds) {
      if (hold.state === 'expired') send(stream, 'hold.expired', { hold_id: hold.id });
    }
    const quotes = await query<{ id: string }>(
      `select id from quotes where (stale or expires_at <= $3)
         and ((username is not null and username = $1) or (username is null and visitor = $2))`,
      [owner, call.ctx.visitorId, new Date(nowMs()).toISOString()],
    );
    for (const row of quotes) {
      const quote = await loadQuoteRow(row.id);
      if (!quote) continue;
      const { announceQuoteChange } = await import('./sweep');
      await announceQuoteChange(quote, quote.stale ? 'rate' : 'expired');
    }
    return;
  }

  if (method === 'GET' && path === '/api/destinations') {
    const q = (call.url.searchParams.get('q') ?? '').toLowerCase();
    const all = await loadDestinations();
    const rows: Record<string, unknown>[] = [];
    for (const destination of all) {
      if (q && !destination.name.toLowerCase().includes(q)) continue;
      const codes = await propertiesOfDestination(destination.code);
      rows.push({ ...destination, property_count: codes.length });
    }
    sendJson(call.res, 200, rows, {}, cookies);
    return;
  }

  if (method === 'POST' && path === '/api/signup') {
    requireVisitor(call);
    const username = stringField(call.json.username).toLowerCase();
    const password = stringField(call.json.password);
    const fields: Record<string, string> = {};
    if (!usernameValid(username)) fields.username = 'signup.username';
    if (password.length < 8) fields.password = 'signup.password';
    if (Object.keys(fields).length > 0) throw validation(fields);
    const existing = await one('select 1 from users where username = $1', [username]);
    if (existing) throw conflict('username_taken');
    await query('insert into users (username, password, role) values ($1,$2,$3)', [
      username,
      hashPassword(password),
      'guest',
    ]);
    const session = await createSession(username);
    sendJson(call.res, 201, { username, role: 'guest' }, {}, [...cookies, cookie('kip_session', session)]);
    return;
  }

  if (method === 'POST' && path === '/api/signin') {
    requireVisitor(call);
    const username = stringField(call.json.username).toLowerCase();
    const password = stringField(call.json.password);
    const limit = rateLimit(`signin:${username}`, config.loginRate);
    if (!limit.ok) {
      sendJson(call.res, 429, { error: 'rate_limited' }, { 'retry-after': String(limit.retryAfter) }, cookies);
      return;
    }
    const row = await one<{ password: string }>('select password from users where username = $1', [username]);
    if (!row || !verifyPassword(password, row.password)) throw unauthorized('bad_credentials');
    const user = await loadUser(username);
    const session = await createSession(username);
    sendJson(call.res, 200, { username, role: user?.role, manages: user?.manages ?? [] }, {}, [
      ...cookies,
      cookie('kip_session', session),
    ]);
    return;
  }

  if (method === 'POST' && path === '/api/signout') {
    if (call.ctx.sessionId) await query('delete from sessions where id = $1', [call.ctx.sessionId]);
    call.res.writeHead(204, { 'set-cookie': [...cookies, clearCookie('kip_session')] });
    call.res.end();
    return;
  }

  if (method === 'POST' && path === '/api/signout-everywhere') {
    const user = requireUser(call);
    await query('delete from sessions where username = $1', [user.username]);
    sendToUser(user.username, 'account.changed', { signed_out: true });
    call.res.writeHead(204, { 'set-cookie': [...cookies, clearCookie('kip_session')] });
    call.res.end();
    return;
  }

  if (method === 'GET' && path === '/api/me') {
    const stays = await completedStays(call.ctx.user?.username ?? null, nowMs());
    const tier = tierOf(stays);
    sendJson(
      call.res,
      200,
      {
        user: call.ctx.user
          ? { username: call.ctx.user.username, role: call.ctx.user.role, manages: call.ctx.user.manages }
          : null,
        lang: call.ctx.lang,
        cur: call.ctx.cur,
        tier: tier.name,
        completed_stays: stays,
        perks: tier.perks,
      },
      {},
      cookies,
    );
    return;
  }

  if (method === 'PATCH' && path === '/api/me/preferences') {
    requireVisitor(call);
    const fields: Record<string, string> = {};
    const lang = call.json.lang;
    const cur = call.json.cur;
    if (lang !== undefined && !LANGS.includes(lang as Lang)) fields.lang = 'invalid';
    if (cur !== undefined && !CURS.includes(cur as Cur)) fields.cur = 'invalid';
    if (Object.keys(fields).length > 0) throw validation(fields);
    await storePreferences(call.ctx, { lang: lang as Lang, cur: cur as Cur });
    if (lang !== undefined) call.ctx.lang = lang as Lang;
    if (cur !== undefined) call.ctx.cur = cur as Cur;
    const stays = await completedStays(call.ctx.user?.username ?? null, nowMs());
    const tier = tierOf(stays);
    const payload = {
      user: call.ctx.user
        ? { username: call.ctx.user.username, role: call.ctx.user.role, manages: call.ctx.user.manages }
        : null,
      lang: call.ctx.lang,
      cur: call.ctx.cur,
      tier: tier.name,
      completed_stays: stays,
      perks: tier.perks,
    };
    const { sendToContext } = await import('./events');
    sendToContext({ visitorId: call.ctx.visitorId, username: call.ctx.user?.username ?? null }, 'account.changed', {
      lang: call.ctx.lang,
      cur: call.ctx.cur,
      tier: tier.name,
      completed_stays: stays,
    });
    sendJson(call.res, 200, payload, {}, cookies);
    return;
  }

  if (method === 'GET' && path === '/api/inbox') {
    const rows = await query<{ id: string; at: string; kind: string; property: string; link: string }>(
      `select i.id, to_char(i.at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at, i.kind, i.property, i.link
       from inbox i
       where ($1::text is not null and i.username = $1) or ($1::text is null and i.visitor = $2)
       order by i.at desc, i.id desc`,
      [call.ctx.user?.username ?? null, call.ctx.visitorId],
    );
    const names = new Map<string, string>();
    for (const row of rows) {
      if (!names.has(row.property)) {
        const property = await loadProperty(row.property);
        names.set(row.property, property?.name ?? row.property);
      }
    }
    sendJson(
      call.res,
      200,
      rows.map((row) => ({
        id: Number(row.id),
        at: row.at,
        kind: row.kind,
        property: names.get(row.property),
        link: row.link,
      })),
      {},
      cookies,
    );
    return;
  }

  if (method === 'GET' && path === '/api/search') {
    const visitor = call.ctx.visitorId ?? 'anonymous';
    const limit = rateLimit(`search:${visitor}`, config.searchRate);
    if (!limit.ok) {
      sendJson(call.res, 429, { error: 'rate_limited' }, { 'retry-after': String(limit.retryAfter) }, cookies);
      return;
    }
    const destination = await loadDestination(call.url.searchParams.get('dest') ?? '');
    const zone = destination?.zone ?? 'UTC';
    const { params, notices, canonical } = normaliseSearch({
      query: call.url.searchParams,
      todayLocal: localDate(zone, nowMs()),
      stored: { lang: call.ctx.lang, cur: call.ctx.cur },
      defaultCentre: { cx: destination?.cx ?? 500, cy: destination?.cy ?? 500 },
    });
    const tier = await callerTier(call);
    const rates = await currencyTable();
    const outcome = await runSearch(params, { nowMs: nowMs(), tierPct: tier.pct, rates });
    sendJson(call.res, 200, { canonical, notices, ...outcome }, {}, cookies);
    return;
  }

  if (method === 'GET' && path === '/api/dates') {
    await handleDates(call);
    return;
  }

  const propertyMatch = /^\/api\/properties\/([A-Za-z0-9-]+)$/.exec(path);
  if (method === 'GET' && propertyMatch) {
    await handleProperty(call, propertyMatch[1]);
    return;
  }

  if (method === 'POST' && path === '/api/allocations') {
    await handleAllocations(call);
    return;
  }

  if (method === 'POST' && path === '/api/quotes') {
    requireVisitor(call);
    const tier = await callerTier(call);
    const row = await createQuote({
      owner: { visitorId: call.ctx.visitorId, username: call.ctx.user?.username ?? null },
      property: stringField(call.json.property),
      in: stringField(call.json.in),
      out: stringField(call.json.out),
      currency: (isCurrency(call.json.currency) ? call.json.currency : 'EUR') as Cur,
      adults: typeof call.json.adults === 'number' ? call.json.adults : undefined,
      ages: Array.isArray(call.json.ages) ? (call.json.ages as number[]) : undefined,
      rooms: Array.isArray(call.json.rooms) ? (call.json.rooms as never[]) : undefined,
      holdId: typeof call.json.hold_id === 'string' ? call.json.hold_id : null,
      tier: tier.name,
    });
    sendJson(call.res, 201, await serialiseQuote(row), {}, cookies);
    return;
  }

  const quoteMatch = /^\/api\/quotes\/([A-Za-z0-9_-]+)$/.exec(path);
  if (method === 'GET' && quoteMatch) {
    const row = await loadQuoteRow(quoteMatch[1]);
    if (!row) throw notFound();
    if (!ownsQuote(row, { visitorId: call.ctx.visitorId, username: call.ctx.user?.username ?? null })) {
      throw notFound();
    }
    sendJson(call.res, 200, await serialiseQuote(row), {}, cookies);
    return;
  }

  if (method === 'POST' && path === '/api/holds') {
    requireVisitor(call);
    const hold = await createHold(stringField(call.json.quote_id), {
      visitorId: call.ctx.visitorId,
      username: call.ctx.user?.username ?? null,
    });
    sendJson(call.res, 201, hold, {}, cookies);
    return;
  }

  const holdMatch = /^\/api\/holds\/([A-Za-z0-9_-]+)$/.exec(path);
  if (method === 'DELETE' && holdMatch) {
    requireVisitor(call);
    await releaseHold(holdMatch[1], {
      visitorId: call.ctx.visitorId,
      username: call.ctx.user?.username ?? null,
    });
    call.res.writeHead(204, cookies.length > 0 ? { 'set-cookie': cookies } : {});
    call.res.end();
    return;
  }

  if (method === 'POST' && path === '/api/bookings') {
    await handleCreateBooking(call);
    return;
  }

  if (method === 'POST' && path === '/api/bookings/find') {
    const visitor = requireVisitor(call);
    const limit = rateLimit(`lookup:${visitor}`, config.lookupRate);
    if (!limit.ok) {
      sendJson(call.res, 429, { error: 'rate_limited' }, { 'retry-after': String(limit.retryAfter) }, cookies);
      return;
    }
    const code = await findBooking(stringField(call.json.code), stringField(call.json.surname));
    if (!code) throw new ApiError(404, { error: 'not_found' });
    await grantAccess(code, visitor);
    sendJson(call.res, 200, { code }, {}, cookies);
    return;
  }

  const bookingMatch = /^\/api\/bookings\/(KW-[A-Z2-9]{6})(\/.*)?$/.exec(path);
  if (bookingMatch) {
    await handleBookingRoutes(call, bookingMatch[1], bookingMatch[2] ?? '');
    return;
  }

  const reviewMatch = /^\/api\/reviews\/([A-Za-z0-9_-]+)$/.exec(path);
  if (reviewMatch && method === 'GET') {
    sendJson(call.res, 200, await reviewWindow(reviewMatch[1]), {}, cookies);
    return;
  }
  if (reviewMatch && method === 'POST') {
    requireVisitor(call);
    const result = await submitReview(reviewMatch[1], call.json as never);
    sendJson(call.res, 201, result, {}, cookies);
    return;
  }

  if (method === 'GET' && path === '/api/moderation/reviews') {
    const user = requireUser(call);
    if (user.role !== 'operator') throw forbidden();
    sendJson(call.res, 200, await pendingReviews(), {}, cookies);
    return;
  }

  const moderateMatch = /^\/api\/moderation\/reviews\/(\d+)\/(publish|reject)$/.exec(path);
  if (method === 'POST' && moderateMatch) {
    const user = requireUser(call);
    const row = await one('select 1 from reviews where id = $1', [Number(moderateMatch[1])]);
    if (!row) throw notFound();
    if (user.role !== 'operator') throw forbidden();
    const result = await moderateReview(Number(moderateMatch[1]), moderateMatch[2] as 'publish' | 'reject');
    sendJson(call.res, 200, result, {}, cookies);
    return;
  }

  if (path.startsWith('/api/manage/')) {
    await handleManage(call);
    return;
  }

  throw notFound();
}

async function handleDates(call: Call): Promise<void> {
  const params = call.url.searchParams;
  const destCode = params.get('dest');
  const propertyCode = params.get('property');
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const cur = isCurrency(params.get('cur')) ? (params.get('cur') as Cur) : 'EUR';
  const start = params.get('start');
  if (!isDate(from) || !isDate(to)) throw validation({ from: 'invalid', to: 'invalid' });

  let codes: string[];
  let zone: string;
  if (propertyCode) {
    const property = await loadProperty(propertyCode);
    if (!property) throw notFound();
    codes = [property.code];
    zone = property.zone;
  } else {
    const destination = await loadDestination(destCode ?? '');
    if (!destination) throw notFound();
    codes = await propertiesOfDestination(destination.code);
    zone = destination.zone;
  }
  const rates = await currencyTable();
  const horizonEnd = addDays(to, 32);
  const inv = await loadInventory(codes, from, horizonEnd);
  const todayLocal = localDate(zone, nowMs());
  const types = codes.flatMap((code) => inv.roomTypes.get(code) ?? []).sort((a, b) => (a.code < b.code ? -1 : 1));
  const lowestRateOn = (date: string): number | null => {
    let lowest: number | null = null;
    for (const rt of types) {
      const night = inv.nights.get(rt.code)?.get(date);
      if (!night) continue;
      const rate = planRate(night, 'refundable');
      lowest = lowest === null ? rate : Math.min(lowest, rate);
    }
    return lowest;
  };
  const arrivalMinStay = (date: string): number => {
    let min: number | null = null;
    for (const rt of types) {
      const night = inv.nights.get(rt.code)?.get(date);
      if (!night) continue;
      min = min === null ? night.min_stay : Math.min(min, night.min_stay);
    }
    return min ?? 1;
  };

  const days = datesBetween(from, addDays(to, 1)).map((date) => {
    if (start && isDate(start)) {
      const minStay = arrivalMinStay(start);
      const lowest = lowestRateOn(date);
      if (date <= start) {
        return {
          date,
          available: false,
          from_minor: null,
          min_stay: minStay,
          reason: null,
          after_start: date === start ? null : ('before' as const),
        };
      }
      let first: ReturnType<typeof checkDepartureDay> | null = null;
      for (const rt of types) {
        const outcome = checkDepartureDay(inv, rt.code, start, date);
        if (outcome.reason === null) {
          return {
            date,
            available: true,
            from_minor: lowest === null ? null : convertTotal(lowest, cur, rates),
            min_stay: minStay,
            reason: null,
            after_start: null,
          };
        }
        if (!first) first = outcome;
      }
      return {
        date,
        available: false,
        from_minor: null,
        min_stay: first?.reason?.n ?? minStay,
        reason: first?.reason ?? null,
        after_start: first?.short ? ('short' as const) : null,
      };
    }
    let lowest: number | null = null;
    let minStay: number | null = null;
    let firstReason: ReturnType<typeof checkArrivalDay> = null;
    for (const rt of types) {
      const reason = checkArrivalDay(inv, rt.code, date, todayLocal);
      if (reason) {
        if (firstReason === null) firstReason = reason;
        continue;
      }
      const night = inv.nights.get(rt.code)?.get(date);
      if (!night) continue;
      const rate = planRate(night, 'refundable');
      lowest = lowest === null ? rate : Math.min(lowest, rate);
      minStay = minStay === null ? night.min_stay : Math.min(minStay, night.min_stay);
    }
    if (lowest === null) {
      return {
        date,
        available: false,
        from_minor: null,
        min_stay: 1,
        reason: firstReason,
        after_start: null,
      };
    }
    return {
      date,
      available: true,
      from_minor: convertTotal(lowest, cur, rates),
      min_stay: minStay ?? 1,
      reason: null,
      after_start: null,
    };
  });
  sendJson(call.res, 200, { days }, {}, call.setCookies);
}

async function handleProperty(call: Call, code: string): Promise<void> {
  const property = await loadProperty(code);
  if (!property) throw notFound();
  const params = call.url.searchParams;
  const inDate = params.get('in') ?? '';
  const outDate = params.get('out') ?? '';
  if (!isDate(inDate) || !isDate(outDate) || diffDays(inDate, outDate) < 1) {
    throw validation({ in: 'invalid', out: 'invalid' });
  }
  const adults = Number(params.get('adults') ?? '2');
  const ages = (params.get('ages') ?? '')
    .split(',')
    .filter((part) => part !== '')
    .map((part) => Number(part));
  const cur = isCurrency(params.get('cur')) ? (params.get('cur') as Cur) : 'EUR';
  const destination = await loadDestination(property.destination);
  const inv = await loadInventory([code], inDate, addDays(outDate, 1));
  const types = inv.roomTypes.get(code) ?? [];
  const tier = await callerTier(call);
  const todayLocal = localDate(property.zone, nowMs());
  const ctx = makeStayContext(property, inDate, outDate, todayLocal, tier.pct);
  const recommendation = recommend({
    ctx,
    inv,
    types,
    party: { adults, ages },
    req: { inDate, outDate, todayLocal },
  });
  const score = await propertyScore(code, nowMs());
  const distance = destination
    ? Math.round(Math.hypot(property.x - destination.cx, property.y - destination.cy) * 10) / 10
    : 0;
  sendJson(
    call.res,
    200,
    {
      code: property.code,
      name: property.name,
      zone: property.zone,
      stars: property.stars,
      amenities: property.amenities,
      score,
      distance_km: distance,
      pictures: [1, 2, 3].map((n) => `/images/${property.code}/${n}.svg`),
      policy: property.policy,
      currency: cur,
      room_types: types.map((rt) => ({
        code: rt.code,
        name: rt.name,
        max_adults: rt.max_adults,
        max_guests: rt.max_guests,
        left: leftOverStay(inv, rt.code, inDate, outDate),
      })),
      recommendation: recommendation
        ? { rooms: recommendation.rooms, total_minor: recommendation.total_minor }
        : null,
    },
    {},
    call.setCookies,
  );
}

async function handleAllocations(call: Call): Promise<void> {
  const body = call.json;
  const property = await loadProperty(stringField(body.property));
  if (!property) throw notFound();
  const inDate = stringField(body.in);
  const outDate = stringField(body.out);
  if (!isDate(inDate) || !isDate(outDate) || diffDays(inDate, outDate) < 1) {
    throw validation({ in: 'invalid', out: 'invalid' });
  }
  const adults = typeof body.adults === 'number' ? body.adults : 2;
  const ages = Array.isArray(body.ages) ? (body.ages as number[]) : [];
  const counts = new Map<string, number>();
  const raw = (body.counts ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) counts.set(key, value);
  }
  const inv = await loadInventory([property.code], inDate, addDays(outDate, 1));
  const types = inv.roomTypes.get(property.code) ?? [];
  for (const code of counts.keys()) {
    if (!types.some((rt) => rt.code === code)) throw validation({ counts: 'invalid' });
  }
  const tier = await callerTier(call);
  const todayLocal = localDate(property.zone, nowMs());
  const ctx = makeStayContext(property, inDate, outDate, todayLocal, tier.pct);
  const outcome = placeOverride(
    { ctx, inv, types, party: { adults, ages }, req: { inDate, outDate, todayLocal } },
    counts,
  );
  if ('advice' in outcome) {
    const advice: Record<string, unknown> = { code: outcome.advice.code, n: outcome.advice.n };
    if (outcome.advice.code === 'capacity') advice.m = outcome.advice.m;
    if (outcome.advice.code === 'left') advice.room_type = outcome.advice.room_type;
    throw new ApiError(422, { error: 'room_advice', advice });
  }
  sendJson(call.res, 200, outcome.allocation, {}, call.setCookies);
}

async function replayOrStore(call: Call, run: () => Promise<{ status: number; body: unknown }>): Promise<void> {
  const key = call.req.headers['idempotency-key'];
  if (typeof key !== 'string' || key === '') {
    throw validation({ 'Idempotency-Key': 'required' });
  }
  const owner = call.ctx.user?.username ?? call.ctx.visitorId ?? '';
  const hash = bodyHash(call.body);
  const stored = await one<{ owner: string; body_hash: string; status: number; response: unknown }>(
    'select owner, body_hash, status, response from idempotency where key = $1',
    [key],
  );
  if (stored) {
    if (stored.body_hash !== hash || stored.owner !== owner) throw conflict('idempotency_conflict');
    const status = stored.status === 201 ? 200 : stored.status;
    sendJson(call.res, status, stored.response, {}, call.setCookies);
    return;
  }
  try {
    const result = await run();
    await query(
      `insert into idempotency (key, owner, body_hash, status, response, at)
       values ($1,$2,$3,$4,$5,$6) on conflict (key) do nothing`,
      [key, owner, hash, result.status, JSON.stringify(result.body), new Date(nowMs()).toISOString()],
    );
    sendJson(call.res, result.status, result.body, {}, call.setCookies);
  } catch (err) {
    if (err instanceof ApiError && err.status === 402) {
      await query(
        `insert into idempotency (key, owner, body_hash, status, response, at)
         values ($1,$2,$3,$4,$5,$6) on conflict (key) do nothing`,
        [key, owner, hash, 402, JSON.stringify(err.body), new Date(nowMs()).toISOString()],
      );
    }
    throw err;
  }
}

async function handleCreateBooking(call: Call): Promise<void> {
  requireVisitor(call);
  await replayOrStore(call, async () => {
    const booking = await createBookingFromHold({
      owner: { visitorId: call.ctx.visitorId, username: call.ctx.user?.username ?? null },
      holdId: stringField(call.json.hold_id),
      quoteId: stringField(call.json.quote_id),
      given_name: stringField(call.json.given_name),
      surname: stringField(call.json.surname),
      card_number: stringField(call.json.card_number),
      expiry: stringField(call.json.expiry),
      security_code: stringField(call.json.security_code),
      step_up_code: call.json.step_up_code,
    });
    return { status: 201, body: booking };
  });
}

async function requireVersion(call: Call, code: string): Promise<void> {
  const header = call.req.headers['if-match'];
  if (typeof header !== 'string' || header === '') throw validation({ 'If-Match': 'required' });
  const row = await loadBookingRow(code);
  if (!row) throw notFound();
  const given = header.replace(/"/g, '');
  if (Number(given) !== row.version) throw conflict('version_conflict');
}

async function handleBookingRoutes(call: Call, code: string, rest: string): Promise<void> {
  const viewer = viewerOf(call);
  const visible = await canSeeBooking(code, viewer);
  if (!visible) throw notFound();
  const method = call.method;

  if (method === 'GET' && rest === '') {
    const booking = await bookingObject(code);
    if (!booking) throw notFound();
    sendJson(call.res, 200, booking, { etag: `"${booking.version}"` }, call.setCookies);
    return;
  }

  if (method === 'GET' && rest === '/cancellations/preview') {
    const rooms = (call.url.searchParams.get('rooms') ?? '')
      .split(',')
      .filter((part) => part !== '')
      .map((part) => Number(part));
    sendJson(call.res, 200, await cancellationPreview(code, rooms), {}, call.setCookies);
    return;
  }

  if (method === 'POST' && rest === '/cancellations') {
    requireVisitor(call);
    await requireVersion(call, code);
    const rooms = Array.isArray(call.json.rooms) ? (call.json.rooms as number[]) : [];
    if (rooms.length === 0) throw validation({ rooms: 'required' });
    const result = await cancelRooms(code, rooms);
    const booking = await bookingObject(code);
    sendJson(call.res, 201, { refund_minor: result.refund_minor, booking }, {}, call.setCookies);
    return;
  }

  if (method === 'POST' && rest === '/changes/preview') {
    const preview = await changePreview(code, stringField(call.json.in), stringField(call.json.out));
    sendJson(call.res, 200, preview, {}, call.setCookies);
    return;
  }

  if (method === 'POST' && rest === '/changes') {
    requireVisitor(call);
    await requireVersion(call, code);
    const tier = await callerTier(call);
    await replayOrStore(call, async () => {
      const booking = await applyChange(
        {
          code,
          in: stringField(call.json.in),
          out: stringField(call.json.out),
          card_number: call.json.card_number,
          expiry: call.json.expiry,
          security_code: call.json.security_code,
          step_up_code: call.json.step_up_code,
        },
        tier.name,
      );
      return { status: 200, body: booking };
    });
    return;
  }

  if (method === 'POST' && rest === '/no-show') {
    const row = await loadBookingRow(code);
    if (!row) throw notFound();
    if (!viewer.manages.includes(row.property)) throw forbidden();
    await requireVersion(call, code);
    sendJson(call.res, 200, await markNoShow(code), {}, call.setCookies);
    return;
  }

  throw notFound();
}

async function handleManage(call: Call): Promise<void> {
  const user = requireUser(call);
  const match = /^\/api\/manage\/([A-Za-z0-9-]+)(\/.*)$/.exec(call.url.pathname);
  if (!match) throw notFound();
  const code = match[1];
  const rest = match[2];
  if (!user.manages.includes(code)) throw notFound();
  const property = await loadProperty(code);
  if (!property) throw notFound();
  const method = call.method;

  if (method === 'GET' && rest === '/calendar') {
    const from = call.url.searchParams.get('from') ?? localDate(property.zone, nowMs());
    const days = Number(call.url.searchParams.get('days') ?? '28');
    if (!isDate(from) || !Number.isInteger(days) || days < 1 || days > 60) {
      throw validation({ from: 'invalid', days: 'invalid' });
    }
    sendJson(call.res, 200, await calendar(code, from, days), {}, call.setCookies);
    return;
  }

  if (method === 'PATCH' && rest === '/nights') {
    const result = await patchNights(code, call.json as never);
    sendJson(call.res, 200, result, {}, call.setCookies);
    return;
  }

  if (method === 'GET' && rest === '/reservations') {
    sendJson(call.res, 200, await reservationRows(code), {}, call.setCookies);
    return;
  }

  if (method === 'GET' && rest === '/reservations.csv') {
    const rows = await reservationRows(code);
    sendText(call.res, 200, reservationsCsv(rows), 'text/csv; charset=utf-8', {
      'content-disposition': `attachment; filename="reservations-${code}.csv"`,
    }, call.setCookies);
    return;
  }

  if (method === 'POST' && (rest === '/imports/preview' || rest === '/imports')) {
    const types = (await query<{ code: string }>('select code from room_types where property = $1 order by code', [
      code,
    ])).map((row) => row.code);
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(call.body);
    } catch {
      sendJson(
        call.res,
        422,
        { error: 'import_invalid', lines: [{ line: 1, key: 'import.header', params: { n: 1 } }] },
        {},
        call.setCookies,
      );
      return;
    }
    const parsed = parseImport(text, types);
    if (parsed.errors.length > 0) {
      sendJson(call.res, 422, { error: 'import_invalid', lines: parsed.errors }, {}, call.setCookies);
      return;
    }
    const changes = await previewChanges(parsed.lines);
    const digest = sha256Of(call.body);
    if (rest === '/imports/preview') {
      sendJson(call.res, 200, { sha256: digest, changes, count: changes.length }, {}, call.setCookies);
      return;
    }
    const key = `imports/${code}/${digest}.kiprates`;
    await putObject(key, call.body, 'text/plain; charset=utf-8');
    const dates = await applyImport(parsed.lines);
    const { broadcast } = await import('./events');
    const { markQuotesStale } = await import('./sweep');
    broadcast('availability', { property: code, room_type: null, dates });
    await markQuotesStale(code, dates);
    sendJson(call.res, 201, { sha256: digest, count: changes.length, key }, {}, call.setCookies);
    return;
  }

  const statementMatch = /^\/statements\/(\d{4}-\d{2})(\.csv)?$/.exec(rest);
  if (method === 'GET' && statementMatch) {
    const month = statementMatch[1];
    const statement = await statementFor(code, month, property.zone, nowMs());
    if (!statementMatch[2]) {
      sendJson(
        call.res,
        200,
        { ...statement, months: await statementMonths(code, property.zone, nowMs()) },
        {},
        call.setCookies,
      );
      return;
    }
    if (!statement.downloadable) throw conflict('month_open');
    const key = `statements/${code}/${month}.csv`;
    let stored = await getObject(key);
    if (!stored) {
      await putObject(key, Buffer.from(statementCsv(statement), 'utf8'), 'text/csv; charset=utf-8');
      stored = await getObject(key);
    }
    if (!stored) throw new ApiError(503, { error: 'storage_unavailable' });
    sendText(call.res, 200, stored.body, 'text/csv; charset=utf-8', {
      'content-disposition': `attachment; filename="statement-${code}-${month}.csv"`,
    }, call.setCookies);
    return;
  }

  throw notFound();
}
