import type { Config } from './config.js';
import { query, withClient } from './db.js';
import { shopNow, shopNowMs, amsterdamDateOf, amsterdamInstant, amsterdamParts } from './clock.js';
import {
  sessionUser, createSession, destroySession, registerUser, signIn, serialiseUser,
  SESSION_COOKIE, type SessionUser,
} from './auth.js';
import { HttpError, errorBody, validationBody, type RequestCtx } from './http.js';
import {
  DONORS, PACKS, HUBS, PACK_STATIONS, HUB_STATIONS, FIXED_LINES, INSPECTION_FEES, ROAD_CLASSES,
  BIKES, SCENE_PARTS, classNameFor, RANGE_CONSUMPTION_WH_PER_KM,
} from './domain/seed.js';
import { canonicalPlate, plateExample } from './domain/plates.js';
import { parseDonorBody, DonorError, type ParsedDonor } from './domain/donors.js';
import { runFitCheck, revisionForYear } from './domain/fit.js';
import { kitQuoteLines, quoteOf, type Fulfilment } from './domain/quote.js';
import { Registry, RegistryError } from './services/registry.js';
import { Killbill } from './services/killbill.js';
import { PaymentRefusal, ProviderStatus, requestPayment } from './domain/payments.js';
import { RefundRefusal, refundLine } from './domain/refunds.js';
import { handleNotification } from './domain/notifications.js';
import { createKitOrder, createBikeOrder, patchOrder, withdrawOrder, switchToWorkshop, deskTransition, markDelivered, recordInspection, LifecycleError } from './domain/lifecycle.js';
import { loadAggregate, serialiseOrder, STAGES, type Stage, type ApiOrder } from './domain/engine.js';
import { holdSlot, confirmRide, cancelRide, getRide, listRides, deskListRides, markOutcome, RideError } from './domain/rides.js';
import { createHash } from 'node:crypto';

// All API routes. Requests and responses are application/json; failures use
// the one error shape.

export interface RouteDeps {
  config: Config;
  registry: Registry;
  killbill: Killbill;
  providers: ProviderStatus;
  secret: string;
}

export async function route(ctx: RequestCtx, deps: RouteDeps): Promise<{ status: number; body: unknown; setCookie?: string; clearCookie?: boolean }> {
  const { config, registry, killbill, providers, secret } = deps;
  const path = ctx.url.pathname;
  const method = ctx.method;

  if (path === '/api/health' && method === 'GET') {
    return { status: 200, body: { status: 'ok' } };
  }

  if (path === '/api/status' && method === 'GET') {
    return {
      status: 200,
      body: {
        killbill: providers.killbill,
        registry: providers.registry,
        serverNow: shopNow(config).toISOString(),
      },
    };
  }

  // ---- Accounts ----
  if (path === '/api/auth/register' && method === 'POST') {
    const body = ctx.body as Record<string, unknown> ?? {};
    const errors: Record<string, string> = {};
    const email = String(body['email'] ?? '').trim();
    const password = String(body['password'] ?? '');
    const name = String(body['name'] ?? '').trim();
    const country = String(body['country'] ?? '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors['email'] = 'Enter a valid email address.';
    if (password.length < 10) errors['password'] = 'Use at least 10 characters.';
    if (name.length < 1) errors['name'] = 'Enter your name.';
    if (!['NL', 'BE', 'DE', 'LU'].includes(country)) errors['country'] = 'Enter NL, BE, DE or LU.';
    if (Object.keys(errors).length > 0) throw new HttpError(422, validationBody(errors));
    let user: SessionUser;
    try {
      user = await registerUser(config, email, password, name, country);
    } catch (e) {
      if (e instanceof Error && e.message === 'email_taken') throw new HttpError(409, errorBody('email_taken'));
      throw e;
    }
    const session = await createSession(config, user.id);
    return { status: 201, body: serialiseUser(user), setCookie: sessionCookie(session) };
  }

  if (path === '/api/auth/sign-in' && method === 'POST') {
    const body = ctx.body as Record<string, unknown> ?? {};
    const email = String(body['email'] ?? '').trim();
    const password = String(body['password'] ?? '');
    if (!email || !password) throw new HttpError(422, validationBody({ email: email ? '' : 'Enter your email.', password: password ? '' : 'Enter your password.' }));
    const user = await signIn(config, email, password);
    if (!user) throw new HttpError(401, errorBody('bad_credentials'));
    const session = await createSession(config, user.id);
    return { status: 200, body: serialiseUser(user), setCookie: sessionCookie(session) };
  }

  if (path === '/api/auth/sign-out' && method === 'POST') {
    await destroySession(config, ctx.cookies);
    return { status: 204, body: null, clearCookie: true };
  }

  if (path === '/api/me' && method === 'GET') {
    const user = await sessionUser(config, ctx.cookies);
    if (!user) throw new HttpError(401, errorBody('unauthenticated'));
    return { status: 200, body: serialiseUser(user) };
  }

  // ---- Catalogue, fit and quote (no sign-in) ----
  if (path === '/api/catalogue' && method === 'GET') {
    return { status: 200, body: catalogueJson() };
  }

  if (path === '/api/plates/lookup' && method === 'POST') {
    const body = ctx.body as Record<string, unknown> ?? {};
    const rawPlate = String(body['plate'] ?? '');
    const country = String(body['country'] ?? '');
    if (!['NL', 'BE', 'DE'].includes(country)) {
      throw new HttpError(422, validationBody({ plate: 'Enter NL, BE or DE.' }));
    }
    const plate = canonicalPlate(rawPlate, country);
    if (!plate) {
      throw new HttpError(422, validationBody({ plate: `Enter a plate like ${plateExample(country)}.` }));
    }
    try {
      const rec = await registry.lookup(plate, country);
      if (!DONORS.some((d) => d.id === rec.model)) {
        throw new HttpError(422, validationBody({ plate: 'That model is not in our catalogue yet.' }));
      }
      return {
        status: 200,
        body: {
          plate, country, model: rec.model, modelName: DONORS.find((d) => d.id === rec.model)!.name,
          firstAdmissionYear: rec.firstAdmissionYear, roadClass: rec.roadClass,
          className: classNameFor(country, rec.roadClass), plateColour: rec.plateColour,
          registeredMassKg: rec.registeredMassKg, revision: revisionForYear(rec.model, rec.firstAdmissionYear),
          confirmed: true,
        },
      };
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (e instanceof RegistryError && e.kind === 'not_found') throw new HttpError(404, errorBody('plate_not_found'));
      throw new HttpError(503, errorBody('registry_unreachable'));
    }
  }

  if (path === '/api/fit-checks' && method === 'POST') return fitCheckRoute(ctx, deps);
  if (path === '/api/quotes' && method === 'POST') return quoteRoute(ctx, deps);

  if (path === '/api/bikes' && method === 'GET') {
    const cls = ctx.url.searchParams.get('class');
    const bikes = BIKES
      .filter((b) => !cls || String(b.roadClass) === cls)
      .sort((a, b) => b.rangeKm - a.rangeKm)
      .map((b) => ({ id: b.id, name: b.name, roadClass: b.roadClass, rangeKm: b.rangeKm, grossCents: b.grossCents }));
    return { status: 200, body: { bikes } };
  }

  if (path.startsWith('/api/bikes/') && path.endsWith('/slots') && method === 'GET') {
    const bikeId = decodeURIComponent(path.split('/')[3]!);
    if (!BIKES.some((b) => b.id === bikeId)) throw new HttpError(404, errorBody('not_found'));
    const slots = await query<{ id: string; bike_id: string; starts_at: Date; local_date: string; local_time: string; status: string }>(
      config,
      `select s.id, s.bike_id, s.starts_at, s.local_date, s.local_time,
              case when exists (select 1 from rides r where r.slot_id = s.id and r.state = 'confirmed') then 'booked'
                   when exists (select 1 from rides r where r.slot_id = s.id and r.state = 'held' and r.expires_at > now()) then 'held'
                   else 'free' end as status
       from slots s where s.bike_id = $1 order by s.starts_at`,
      [bikeId],
    );
    return {
      status: 200,
      body: {
        slots: slots.rows.map((s) => ({
          id: s.id, bikeId: s.bike_id, startsAt: new Date(s.starts_at).toISOString(),
          localDate: s.local_date, localTime: s.local_time, status: s.status,
        })),
      },
    };
  }

  // ---- Test rides (rider session) ----
  if (path === '/api/test-rides' && method === 'GET') {
    const user = await sessionUser(config, ctx.cookies);
    if (!user) throw new HttpError(401, errorBody('unauthenticated'));
    return { status: 200, body: { rides: await listRides(config, user.id) } };
  }
  if (path === '/api/test-rides/holds' && method === 'POST') {
    const user = await sessionUser(config, ctx.cookies);
    if (!user) throw new HttpError(401, errorBody('unauthenticated'));
    const body = ctx.body as Record<string, unknown> ?? {};
    const slotId = String(body['slotId'] ?? '');
    if (!slotId) throw new HttpError(422, validationBody({ slotId: 'Required.' }));
    try {
      const ride = await holdSlot(config, user.id, slotId, config.holdSeconds);
      return { status: 201, body: ride };
    } catch (e) {
      throw rideError(e);
    }
  }

  if (path.startsWith('/api/test-rides/')) {
    const user = await sessionUser(config, ctx.cookies);
    if (!user) throw new HttpError(401, errorBody('unauthenticated'));
    const rest = path.slice('/api/test-rides/'.length);
    if (rest.includes('/')) {
      const [rideId, action] = rest.split('/');
      const rideRow = await getRide(config, rideId, user.id);
      if (!rideRow) throw new HttpError(404, errorBody('not_found'));
      if (action === 'confirm' && method === 'POST') {
        try {
          return { status: 200, body: await confirmRide(config, rideId, user.id) };
        } catch (e) {
          throw rideError(e);
        }
      }
      if (action === 'cancel' && method === 'POST') {
        try {
          return { status: 200, body: await cancelRide(config, rideId, user.id) };
        } catch (e) {
          throw rideError(e);
        }
      }
      throw new HttpError(404, errorBody('not_found'));
    }
    if (method === 'GET') {
      const ride = await getRide(config, rest, user.id);
      if (!ride) throw new HttpError(404, errorBody('not_found'));
      return { status: 200, body: ride };
    }
    throw new HttpError(404, errorBody('not_found'));
  }

  // ---- Orders (rider session) ----
  if (path === '/api/orders' && method === 'POST') {
    const user = await sessionUser(config, ctx.cookies);
    if (!user) throw new HttpError(401, errorBody('unauthenticated'));
    const body = ctx.body as Record<string, unknown> ?? {};
    const kind = String(body['kind'] ?? '');
    const plan = body['plan'] as Record<string, unknown> | undefined;
    const expectedTotalCents = body['expectedTotalCents'];
    if (typeof expectedTotalCents !== 'number') {
      throw new HttpError(422, validationBody({ expectedTotalCents: 'Required.' }));
    }
    const planErrors: Record<string, string> = {};
    const planJson = plan ?? {};
    for (const field of ['name', 'street', 'postcode', 'city']) {
      if (!String(planJson[field] ?? '').trim()) planErrors[field] = 'Required.';
    }
    const note = planJson['note'] === undefined ? '' : String(planJson['note']);
    if (note.length > 500) planErrors['note'] = 'Keep the note to 500 characters.';
    if (Object.keys(planErrors).length > 0) throw new HttpError(422, validationBody(planErrors));
    const cleanPlan = {
      name: String(planJson['name'] ?? ''), street: String(planJson['street'] ?? ''),
      postcode: String(planJson['postcode'] ?? ''), city: String(planJson['city'] ?? ''),
      ...(note ? { note } : {}),
    };
    if (kind === 'kit') {
      const cfg = body['config'] as Record<string, unknown> | undefined;
      if (!cfg) throw new HttpError(422, validationBody({ config: 'Required.' }));
      try {
        const result = await createKitOrder(config, registry, providers.registry === 'up', user.id, {
          rawConfig: cfg,
          plan: cleanPlan,
          expectedTotalCents,
        });
        return { status: result.status, body: result.body };
      } catch (e) {
        throw lifecycleError(e);
      }
    }
    if (kind === 'bike') {
      const bikeId = String(body['bikeId'] ?? '');
      if (!BIKES.some((b) => b.id === bikeId)) throw new HttpError(404, errorBody('not_found'));
      try {
        const result = await createBikeOrder(config, user.id, bikeId, cleanPlan as never, expectedTotalCents);
        return { status: result.status, body: result.body };
      } catch (e) {
        throw lifecycleError(e);
      }
    }
    throw new HttpError(422, validationBody({ kind: 'Required.' }));
  }

  if (path === '/api/orders' && method === 'GET') {
    const user = await sessionUser(config, ctx.cookies);
    if (!user) throw new HttpError(401, errorBody('unauthenticated'));
    const ids = await query<{ id: string }>(config, 'select id from orders where user_id = $1 order by created_at desc', [user.id]);
    const orders: ApiOrder[] = [];
    const nowMs = shopNowMs(config);
    for (const row of ids.rows) {
      const agg = await loadAggregate(config, row.id);
      if (agg) orders.push(serialiseOrder(agg, nowMs));
    }
    return { status: 200, body: { orders } };
  }

  if (path.startsWith('/api/orders/')) {
    const rest = path.slice('/api/orders/'.length);
    const user = await sessionUser(config, ctx.cookies);
    if (!user) throw new HttpError(401, errorBody('unauthenticated'));
    if (rest.includes('/')) {
      const [orderId, action] = rest.split('/');
      const agg = await loadAggregate(config, orderId);
      if (!agg || agg.order.userId !== user.id) throw new HttpError(404, errorBody('not_found'));
      if (action === 'payments' && method === 'POST') {
        const body = ctx.body as Record<string, unknown> ?? {};
        const stage = String(body['stage'] ?? '');
        if (!STAGES.includes(stage as Stage)) throw new HttpError(422, validationBody({ stage: 'Required.' }));
        const key = requireIdempotencyKey(ctx);
        return await withIdempotency(config, user.id, key, ctx, async () => {
          try {
            const result = await requestPayment(config, killbill, registry, providers, user.id, orderId, stage as Stage, key, { name: user.name, email: user.email });
            return { status: result.status, body: result.body };
          } catch (e) {
            throw paymentRefusalError(e);
          }
        });
      }
      if (action === 'withdraw' && method === 'POST') {
        const key = requireIdempotencyKey(ctx);
        return await withIdempotency(config, user.id, key, ctx, async () => {
          try {
            const result = await withdrawOrder(config, killbill, providers.killbill === 'up', orderId, user.id, key);
            return { status: result.status, body: result.body };
          } catch (e) {
            throw lifecycleError(e);
          }
        });
      }
      if (action === 'switch-to-workshop' && method === 'POST') {
        const key = requireIdempotencyKey(ctx);
        return await withIdempotency(config, user.id, key, ctx, async () => {
          try {
            const result = await switchToWorkshop(config, orderId, user.id);
            return { status: result.status, body: result.body };
          } catch (e) {
            throw lifecycleError(e);
          }
        });
      }
      throw new HttpError(404, errorBody('not_found'));
    }
    if (method === 'GET') {
      const agg = await loadAggregate(config, rest);
      if (!agg || agg.order.userId !== user.id) throw new HttpError(404, errorBody('not_found'));
      return { status: 200, body: serialiseOrder(agg, shopNowMs(config)) };
    }
    if (method === 'PATCH') {
      const body = ctx.body as Record<string, unknown> ?? {};
      try {
        const result = await patchOrder(config, rest, user.id, body as never);
        return { status: result.status, body: result.body };
      } catch (e) {
        throw lifecycleError(e);
      }
    }
    throw new HttpError(404, errorBody('not_found'));
  }

  // ---- Desk (fitter session) ----
  if (path === '/api/desk/orders' && method === 'GET') {
    const user = await sessionUser(config, ctx.cookies);
    if (!user) throw new HttpError(401, errorBody('unauthenticated'));
    if (user.role !== 'fitter') throw new HttpError(403, errorBody('forbidden'));
    const ids = await query<{ id: string }>(config, 'select id from orders order by created_at desc');
    const orders: ApiOrder[] = [];
    const nowMs = shopNowMs(config);
    for (const row of ids.rows) {
      const agg = await loadAggregate(config, row.id);
      if (agg) orders.push(serialiseOrder(agg, nowMs));
    }
    return { status: 200, body: { orders } };
  }

  if (path.startsWith('/api/desk/')) {
    const user = await sessionUser(config, ctx.cookies);
    if (!user) throw new HttpError(401, errorBody('unauthenticated'));
    if (user.role !== 'fitter') throw new HttpError(403, errorBody('forbidden'));
    const rest = path.slice('/api/desk/'.length);

    if (rest === 'ride-days' && method === 'POST') {
      const body = ctx.body as Record<string, unknown> ?? {};
      const bikeId = String(body['bikeId'] ?? '');
      const date = String(body['date'] ?? '');
      const times = (body['times'] as string[] | undefined) ?? [];
      if (!BIKES.some((b) => b.id === bikeId)) throw new HttpError(422, validationBody({ bikeId: 'Required.' }));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(422, validationBody({ date: 'Enter a date as YYYY-MM-DD.' }));
      const today = amsterdamParts(shopNowMs(config)).date;
      if (date < today) throw new HttpError(422, validationBody({ date: 'The date cannot be in the past.' }));
      const timeErrors: Record<string, string> = {};
      for (const t of times) {
        if (!/^\d{2}:\d{2}$/.test(t) || Number(t.slice(0, 2)) > 23 || Number(t.slice(3)) > 59) {
          timeErrors['times'] = 'Enter 24-hour times as HH:MM.';
          break;
        }
      }
      if (Object.keys(timeErrors).length > 0) throw new HttpError(422, validationBody(timeErrors));
      // Times that do not exist on the spring clock change are refused.
      const uniqueTimes = [...new Set(times.map((t) => `${t.slice(0, 5)}`))];
      for (const t of uniqueTimes) {
        const instant = amsterdamInstant(date, `${t}:00`);
        if (!instant.exists) throw new HttpError(422, validationBody({ times: 'That time does not exist on this date.' }));
      }
      const created: unknown[] = [];
      try {
        await withClient(config, async (client) => {
          for (const t of uniqueTimes) {
            const instant = amsterdamInstant(date, `${t}:00`).instant;
            const id = `slot-${createHash('sha256').update(`${bikeId}|${date}|${t}`).digest('hex').slice(0, 12)}`;
            const exists = await client.query('select 1 from slots where id = $1', [id]);
            if (exists.rows.length > 0) throw new HttpError(409, errorBody('slot_exists'));
            await client.query(
              `insert into slots (id, bike_id, starts_at, local_date, local_time) values ($1, $2, $3, $4, $5)`,
              [id, bikeId, new Date(instant).toISOString(), date, t],
            );
            created.push({ id, bikeId, startsAt: new Date(instant).toISOString(), localDate: date, localTime: t, status: 'free' });
          }
        });
      } catch (e) {
        if (e instanceof HttpError) throw e;
        throw e;
      }
      return { status: 201, body: { slots: created } };
    }

    if (rest === 'rides' && method === 'GET') {
      const date = ctx.url.searchParams.get('date') ?? amsterdamParts(shopNowMs(config)).date;
      return { status: 200, body: { rides: await deskListRides(config, date) } };
    }

    if (rest.startsWith('rides/')) {
      const parts = rest.split('/');
      if (parts.length === 3 && parts[2] === 'outcome' && method === 'POST') {
        const rideId = parts[1]!;
        const body = ctx.body as Record<string, unknown> ?? {};
        const outcome = String(body['outcome'] ?? '');
        if (outcome !== 'ridden' && outcome !== 'no-show') {
          throw new HttpError(422, validationBody({ outcome: 'Enter ridden or no-show.' }));
        }
        try {
          return { status: 200, body: await markOutcome(config, rideId, outcome) };
        } catch (e) {
          throw rideError(e);
        }
      }
      throw new HttpError(404, errorBody('not_found'));
    }

    if (rest.startsWith('orders/')) {
      const sub = rest.slice('orders/'.length);
      if (!sub.includes('/') && method === 'GET') {
        const agg = await loadAggregate(config, sub);
        if (!agg) throw new HttpError(404, errorBody('not_found'));
        const order = serialiseOrder(agg, shopNowMs(config));
        const payments = agg.payments.map((p) => ({
          stage: p.stage, amountCents: p.amountCents, status: p.status,
          killbillPaymentId: p.killbillPaymentId, killbillTransactionId: p.killbillTransactionId,
        }));
        return { status: 200, body: { ...order, payments } };
      }
      const [orderId, action] = sub.split('/');
      const agg = await loadAggregate(config, orderId);
      if (!agg) throw new HttpError(404, errorBody('not_found'));
      if (action === 'refunds' && method === 'POST') {
        const body = ctx.body as Record<string, unknown> ?? {};
        const lineId = String(body['lineId'] ?? '');
        const amountCents = body['amountCents'];
        if (typeof amountCents !== 'number' || !Number.isInteger(amountCents) || amountCents < 1) {
          throw new HttpError(422, validationBody({ amountCents: 'Enter an amount like 12.50.' }));
        }
        const key = requireIdempotencyKey(ctx);
        return await withIdempotency(config, user.id, key, ctx, async () => {
          try {
            const result = await refundLine(config, killbill, providers.killbill === 'up', orderId, lineId, amountCents, key, user.id);
            return { status: result.status, body: result.body };
          } catch (e) {
            if (e instanceof RefundRefusal && e.code === 'amount_exceeds') {
              throw new HttpError(422, validationBody({ amountCents: 'That is more than this line has collected.' }));
            }
            throw refundRefusalError(e);
          }
        });
      }
      if (action === 'transitions' && method === 'POST') {
        const body = ctx.body as Record<string, unknown> ?? {};
        const to = String(body['to'] ?? '');
        if (to !== 'kit dispatched' && to !== 'fitted') throw new HttpError(422, validationBody({ to: 'Enter kit dispatched or fitted.' }));
        try {
          const result = await deskTransition(config, orderId, to);
          return { status: result.status, body: result.body };
        } catch (e) {
          throw lifecycleError(e);
        }
      }
      if (action === 'delivered' && method === 'POST') {
        const body = ctx.body as Record<string, unknown> ?? {};
        const deliveredOn = String(body['deliveredOn'] ?? '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveredOn)) {
          throw new HttpError(422, validationBody({ deliveredOn: 'Enter a date as YYYY-MM-DD.' }));
        }
        const today = amsterdamParts(shopNowMs(config)).date;
        if (deliveredOn > today) {
          throw new HttpError(422, validationBody({ deliveredOn: 'The delivery date cannot be in the future.' }));
        }
        try {
          const result = await markDelivered(config, orderId, deliveredOn, agg.order.config?.country ?? 'NL');
          return { status: result.status, body: result.body };
        } catch (e) {
          throw lifecycleError(e);
        }
      }
      if (action === 'inspection' && method === 'POST') {
        try {
          const result = await recordInspection(config, registry, providers.registry === 'up', orderId);
          return { status: result.status, body: result.body };
        } catch (e) {
          throw lifecycleError(e);
        }
      }
      throw new HttpError(404, errorBody('not_found'));
    }
    throw new HttpError(404, errorBody('not_found'));
  }

  // ---- Kill Bill callback ----
  if (path.startsWith('/api/killbill/notifications/') && method === 'POST') {
    const pathSecret = path.slice('/api/killbill/notifications/'.length);
    if (pathSecret !== secret) throw new HttpError(404, errorBody('not_found'));
    if (ctx.body === null && ctx.rawBody !== null && ctx.rawBody.length > 0) {
      throw new HttpError(400, errorBody('bad_notification'));
    }
    if (ctx.body !== null && typeof ctx.body !== 'object') {
      throw new HttpError(400, errorBody('bad_notification'));
    }
    const result = await handleNotification(config, killbill, secret, pathSecret, ctx.body);
    if (result === 'provider_unreachable') throw new HttpError(503, errorBody('provider_unreachable'));
    if (result === 'bad_notification') throw new HttpError(400, errorBody('bad_notification'));
    return { status: 200, body: { status: 'ok' } };
  }

  throw new HttpError(404, errorBody('not_found'));
}

function rideError(e: unknown): HttpError {
  if (e instanceof RideError) {
    return new HttpError(e.status, errorBody(e.code));
  }
  if (e instanceof HttpError) return e;
  throw e;
}

function refundRefusalError(e: unknown): HttpError {
  if (e instanceof RefundRefusal) {
    if (e.code === 'not_found') return new HttpError(404, errorBody('not_found'));
    return new HttpError(e.status, errorBody(e.code));
  }
  if (e instanceof HttpError) return e;
  throw e;
}

function lifecycleError(e: unknown): HttpError {
  if (e instanceof LifecycleError) {
    if (e.code === 'not_found') return new HttpError(404, errorBody('not_found'));
    if (e.code === 'plate_not_found') return new HttpError(404, errorBody('plate_not_found'));
    if (e.code === 'validation_fields') {
      let parsed: Record<string, string> = {};
      try {
        parsed = JSON.parse(e.field ?? '{}');
      } catch {
        parsed = {};
      }
      return new HttpError(422, validationBody(parsed));
    }
    if (e.code === 'note_too_long') return new HttpError(422, validationBody({ note: 'Keep the note to 500 characters.' }));
    if (e.code === 'plan_version_required') return new HttpError(422, validationBody({ planVersion: 'Required.' }));
    if (e.code === 'stale_version') return new HttpError(412, errorBody('stale_version'));
    return new HttpError(e.status, errorBody(e.code));
  }
  if (e instanceof HttpError) return e;
  if (e instanceof PaymentRefusal) return paymentRefusalError(e);
  throw e;
}

function paymentRefusalError(e: unknown): HttpError {
  if (e instanceof PaymentRefusal) {
    if (e.code === 'not_found') return new HttpError(404, errorBody('not_found'));
    return new HttpError(e.status, errorBody(e.code));
  }
  if (e instanceof HttpError) return e;
  throw e;
}

function requireIdempotencyKey(ctx: RequestCtx): string {
  const key = ctx.headers['idempotency-key'];
  if (!key) throw new HttpError(422, validationBody({ idempotencyKey: 'Required.' }));
  if (key.length > 200) throw new HttpError(422, validationBody({ idempotencyKey: 'Keep the key to 200 characters.' }));
  return key;
}

// One idempotency record per key per user: a repeat returns the stored status
// and body; a different body conflicts; a concurrent repeat waits.
async function withIdempotency(
  config: Config, userId: string, key: string, ctx: RequestCtx,
  fn: () => Promise<{ status: number; body: unknown }>,
): Promise<{ status: number; body: unknown }> {
  const requestHash = createHash('sha256').update(`${ctx.method}|${ctx.path}|${JSON.stringify(ctx.body ?? null)}`).digest('hex');
  return withClient(config, async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [`idem:${userId}:${key}`]);
    const existing = await client.query<{ status: number; body: unknown; request_hash: string }>(
      'select status, body, request_hash from idempotency where user_id = $1 and key = $2', [userId, key],
    );
    if (existing.rows.length > 0) {
      if (existing.rows[0]!.request_hash !== requestHash) {
        throw new HttpError(409, errorBody('idempotency_conflict'));
      }
      return { status: existing.rows[0]!.status, body: existing.rows[0]!.body };
    }
    let result: { status: number; body: unknown };
    try {
      result = await fn();
    } catch (e) {
      // Refusals before any provider call store nothing; the key stays usable.
      throw e;
    }
    if (result.status === 200 || result.status === 202 || result.status === 402) {
      await client.query(
        `insert into idempotency (key, user_id, status, body, request_hash) values ($1, $2, $3, $4, $5)`,
        [key, userId, result.status, JSON.stringify(result.body), requestHash],
      );
    }
    return result;
  });
}

// ---- Fit checks and quotes ----------------------------------------------

async function parseDonor(ctx: RequestCtx, registry: Registry): Promise<ParsedDonor> {
  const body = ctx.body as Record<string, unknown> ?? {};
  const donor = body['donor'] as Record<string, unknown> | undefined;
  if (!donor) throw new HttpError(422, validationBody({ donor: 'Required.' }));
  try {
    return await parseDonorBody(donor, registry);
  } catch (e) {
    if (e instanceof DonorError) {
      if (e.status === 404) throw new HttpError(404, errorBody('plate_not_found'));
      if (e.status === 503) throw new HttpError(503, errorBody('registry_unreachable'));
      let errors: Record<string, string> = {};
      try {
        errors = JSON.parse(e.message ?? '{}');
      } catch {
        errors = {};
      }
      throw new HttpError(422, validationBody(errors));
    }
    throw e;
  }
}

function parseKitConfig(ctx: RequestCtx, donor: ParsedDonor): { packId: string; hubId: string; roadClass: 25 | 45; fulfilment: Fulfilment; country: string; units: 'metric' | 'imperial' } {
  const body = ctx.body as Record<string, unknown> ?? {};
  const cfg = (body['config'] as Record<string, unknown> | undefined) ?? (body as Record<string, unknown>);
  const packId = String(cfg['packId'] ?? '');
  const hubId = String(cfg['hubId'] ?? '');
  const roadClass = Number(cfg['roadClass'] ?? 0);
  const fulfilment = String(cfg['fulfilment'] ?? 'posted');
  const country = String(cfg['country'] ?? 'NL');
  const units = String(cfg['units'] ?? 'metric') === 'imperial' ? 'imperial' : 'metric';
  const errors: Record<string, string> = {};
  if (!PACKS.some((p) => p.id === packId)) errors['packId'] = 'Required.';
  if (!HUBS.some((h) => h.id === hubId)) errors['hubId'] = 'Required.';
  if (roadClass !== 25 && roadClass !== 45) errors['roadClass'] = 'Required.';
  if (fulfilment !== 'posted' && fulfilment !== 'workshop') errors['fulfilment'] = 'Required.';
  if (!['NL', 'BE', 'DE', 'LU'].includes(country)) errors['country'] = 'Enter NL, BE, DE or LU.';
  if (roadClass < donor.donor.roadClass) errors['roadClass'] = 'A kit cannot move a scooter down a road class.';
  if (Object.keys(errors).length > 0) throw new HttpError(422, validationBody(errors));
  return { packId, hubId, roadClass: roadClass as 25 | 45, fulfilment: fulfilment as Fulfilment, country, units };
}

async function fitCheckRoute(ctx: RequestCtx, deps: RouteDeps): Promise<{ status: number; body: unknown }> {
  const donor = await parseDonor(ctx, deps.registry);
  const cfg = parseKitConfig(ctx, donor);
  const fit = runFitCheck({ donor: donor.donor, packId: cfg.packId, hubId: cfg.hubId, roadClass: cfg.roadClass, units: cfg.units }, !donor.manual);
  return { status: 200, body: fitJson(fit, donor) };
}

async function quoteRoute(ctx: RequestCtx, deps: RouteDeps): Promise<{ status: number; body: unknown }> {
  const donor = await parseDonor(ctx, deps.registry);
  const cfg = parseKitConfig(ctx, donor);
  const today = amsterdamDateOf(shopNowMs(deps.config));
  const lines = kitQuoteLines({
    kind: 'kit',
    donorModel: donor.donor.model,
    donorCountry: donor.donor.country,
    donorClass: donor.donor.roadClass,
    packId: cfg.packId, hubId: cfg.hubId, roadClass: cfg.roadClass,
    fulfilment: cfg.fulfilment, country: cfg.country,
  }, today);
  const fit = runFitCheck({ donor: donor.donor, packId: cfg.packId, hubId: cfg.hubId, roadClass: cfg.roadClass, units: cfg.units }, !donor.manual);
  const quote = quoteOf(lines, fit);
  const notices = [...quote.notices];
  if (donor.donor.roadClass !== cfg.roadClass) {
    notices.push(
      'Plate: a new plate is needed for the new class.',
      'Helmet: a helmet is required in the 45 km/h class.',
      'Licence: check the licence your class requires before riding.',
    );
  }
  return {
    status: 200,
    body: {
      lines,
      totalCents: quote.totalCents,
      vatCents: quote.vatCents,
      vatRatePct: quote.vatRatePct,
      schedule: quote.schedule,
      notices,
      fit: fitJson(fit, donor),
    },
  };
}

function fitJson(fit: ReturnType<typeof runFitCheck>, donor: ParsedDonor): Record<string, unknown> {
  const sentence = fit.sentence + (donor.manual ? ' Donor unconfirmed.' : '');
  return {
    ...fit,
    sentence,
    confirmed: !donor.manual,
    parts: scenePartsFor(donor.donor.model),
  };
}

export function scenePartsFor(model: string): Record<string, unknown>[] {
  const donor = DONORS.find((d) => d.id === model)!;
  return SCENE_PARTS.map((p) => ({
    id: p.id,
    name: p.name,
    position: p.position.map((v, i) => {
      if (p.id === 'front-wheel' || p.id === 'front-fork') return i === 0 ? donor.wheelbaseMm : v;
      if (p.id === 'traction-pack') return i === 0 ? donor.bayXmm : v;
      return v;
    }),
    storyStage: p.storyStage,
    axis: p.axis,
    storyDistanceMm: p.storyDistanceMm,
    fadedFor: p.fadedFor,
    dimension: p.dimension,
  }));
}

function catalogueJson(): Record<string, unknown> {
  return {
    donors: DONORS.map((d) => ({
      id: d.id, name: d.name, powerKw: d.powerKwTenths / 10, wheelbaseMm: d.wheelbaseMm / 10,
      chassisMassKg: d.chassisMassKg / 10, chassisXmm: d.chassisXmm / 10,
      engineMassKg: d.engineMassKg / 10, engineXmm: d.engineXmm / 10,
      fuelTankMassKg: d.fuelTankMassKg / 10, fuelTankXmm: d.fuelTankXmm / 10,
      bayXmm: d.bayXmm / 10,
      revisions: PACK_STATIONS.filter((s) => s.model === d.id).map((s) => ({
        revision: s.revision,
        stations: s.stations.map((st) => ({ id: st.id, name: st.name, travelMm: st.travelMm / 10, widthMm: st.widthMm / 10, heightMm: st.heightMm / 10 })),
      })),
      hubStations: HUB_STATIONS.map((st) => ({ id: st.id, name: st.name, travelMm: st.travelMm / 10 })),
    })),
    packs: PACKS.map((p) => ({
      id: p.id, widthMm: p.widthMm / 10, heightMm: p.heightMm / 10, wh: p.wh,
      massKg: p.massKg / 10,
      growth: p.growth ? { dimension: p.growth.dimension, mm: p.growth.mm / 10 } : null,
      grossCents: p.grossCents,
    })),
    hubs: HUBS.map((h) => ({
      id: h.id, widthMm: h.widthMm / 10, shaftMm: h.shaftMm / 10, kw: h.kwTenths / 10,
      massKg: h.massKg / 10, grossCents: h.grossCents,
    })),
    parts: SCENE_PARTS.map((p) => ({
      id: p.id, name: p.name, position: p.position, storyStage: p.storyStage, axis: p.axis,
      storyDistanceMm: p.storyDistanceMm, fadedFor: p.fadedFor, dimension: p.dimension,
    })),
    roadClasses: ROAD_CLASSES,
    fixedLines: Object.values(FIXED_LINES).map((l) => ({ code: l.code, name: l.name, grossCents: l.grossCents })),
    inspectionFees: INSPECTION_FEES.map((f) => ({ code: f.code, country: f.country, upTo: f.upTo, cents: f.cents })),
    rangeConsumption: RANGE_CONSUMPTION_WH_PER_KM,
  };
}

function sessionCookie(session: { token: string; expiresAt: Date }): string {
  return `${SESSION_COOKIE}=${session.token}; Path=/; HttpOnly; SameSite=Lax; Expires=${session.expiresAt.toUTCString()}`;
}
