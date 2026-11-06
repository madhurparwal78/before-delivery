/** Every API endpoint, wired to the module that decides its rule. */
import { timingSafeEqual } from 'node:crypto';
import { register, signIn, signOut, sessionCookie, COOKIE, toUser } from './auth.js';
import { BIKES, catalogue } from './catalogue.js';
import { shopNow } from './clock.js';
import { config } from './config.js';
import { sql } from './db.js';
import { recordDelivery, recordInspection, transition } from './desk.js';
import { fail, isRecord, notFound } from './errors.js';
import { route, uuidParam } from './http.js';
import { fingerprint, idempotent } from './idempotency.js';
import { KillBillUnreachable, callbackSecret, killbillStatus } from './killbill.js';
import { createOrder, listDeskOrders, listOrders, loadDeskOrder, loadOrder, orderRow, ownOrder, patchOrder } from './orders.js';
import { handleNotification, payStage } from './payments.js';
import { lookupFrame, plateRecordBody, quoteOfResolved, resolveConfig } from './quotes.js';
import { fitResult } from './fit.js';
import { registryStatus } from './registry.js';
import { requestRefund, switchToWorkshop, withdraw } from './refunds.js';
import { cancelRide, confirmRide, getRide, holdSlot, listRides, markOutcome, openSlots, ridesOn, slotsOf } from './rides.js';

const keyOf = (header: string | undefined): string | undefined => (header === undefined || header === '' ? undefined : header);

export function registerRoutes(): void {
  route('GET', '/api/health', 'none', async () => ({ status: 200, body: { status: 'ok' } }));
  route('GET', '/api/status', 'none', async () => ({
    status: 200, body: { killbill: await killbillStatus(), registry: await registryStatus(), serverNow: shopNow().toISOString() },
  }));

  // accounts
  route('POST', '/api/auth/register', 'none', async (ctx) => {
    const { user, token } = await register(await ctx.json());
    return { status: 201, body: user, headers: { 'Set-Cookie': sessionCookie(token, config.sessionSeconds) } };
  });
  route('POST', '/api/auth/sign-in', 'none', async (ctx) => {
    const { user, token } = await signIn(await ctx.json());
    return { status: 200, body: user, headers: { 'Set-Cookie': sessionCookie(token, config.sessionSeconds) } };
  });
  route('POST', '/api/auth/sign-out', 'none', async (ctx) => {
    await signOut(ctx.req);
    return { status: 204, headers: { 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` } };
  });
  route('GET', '/api/me', 'user', async (ctx) => ({ status: 200, body: toUser(ctx.user) }));

  // catalogue, fit and quote
  route('GET', '/api/catalogue', 'none', async () => ({ status: 200, body: catalogue() }));
  route('POST', '/api/plates/lookup', 'none', async (ctx) => {
    const body = await ctx.json();
    const { record, frame } = await lookupFrame(typeof body['plate'] === 'string' ? body['plate'] : '', body['country']);
    return { status: 200, body: plateRecordBody(record, frame) };
  });
  route('POST', '/api/fit-checks', 'none', async (ctx) => {
    const body = await ctx.json();
    const resolved = await resolveConfig({ ...body, fulfilment: 'posted', country: 'NL' });
    return { status: 200, body: fitResult(resolved.frame, resolved.pack, resolved.hub, resolved.target, resolved.units) };
  });
  route('POST', '/api/quotes', 'none', async (ctx) => ({ status: 200, body: quoteOfResolved(await resolveConfig(await ctx.json())) }));
  route('GET', '/api/bikes', 'none', async (ctx) => {
    const filter = ctx.query.get('class');
    const bikes = BIKES.filter((b) => !filter || String(b.roadClass) === filter).sort((a, b) => b.rangeKm - a.rangeKm);
    return { status: 200, body: { bikes } };
  });
  route('GET', '/api/bikes/:id/slots', 'none', async (ctx) => {
    return { status: 200, body: { slots: await slotsOf(ctx.params['id']) } };
  });

  // orders
  route('POST', '/api/orders', 'user', async (ctx) => ({ status: 201, body: await createOrder(ctx.user, await ctx.json()) }));
  route('GET', '/api/orders', 'user', async (ctx) => ({ status: 200, body: { orders: await listOrders(ctx.user) } }));
  route('GET', '/api/orders/:id', 'user', async (ctx) => {
    const row = await ownOrder(sql, ctx.user, uuidParam(ctx.params['id']));
    return { status: 200, body: await loadOrder(sql, row.id) };
  });
  route('PATCH', '/api/orders/:id', 'user', async (ctx) => ({ status: 200, body: await patchOrder(ctx.user, uuidParam(ctx.params['id']), await ctx.json()) }));

  route('POST', '/api/orders/:id/payments', 'user', async (ctx) => {
    const id = uuidParam(ctx.params['id']);
    const body = await ctx.json();
    const key = keyOf(ctx.header('idempotency-key'));
    return idempotent(ctx.user.id, key, fingerprint('POST', ctx.req.url ?? '', body), async () => { await ownOrder(sql, ctx.user, id); },
      (usable) => payStage(ctx.user, id, body['stage'], usable));
  });
  route('POST', '/api/orders/:id/withdraw', 'user', async (ctx) => {
    const id = uuidParam(ctx.params['id']);
    const key = keyOf(ctx.header('idempotency-key'));
    return idempotent(ctx.user.id, key, fingerprint('POST', ctx.req.url ?? '', await ctx.json()), async () => { await ownOrder(sql, ctx.user, id); },
      (usable) => withdraw(ctx.user, id, usable));
  });
  route('POST', '/api/orders/:id/switch-to-workshop', 'user', async (ctx) => {
    const id = uuidParam(ctx.params['id']);
    const key = keyOf(ctx.header('idempotency-key'));
    return idempotent(ctx.user.id, key, fingerprint('POST', ctx.req.url ?? '', await ctx.json()), async () => { await ownOrder(sql, ctx.user, id); },
      () => switchToWorkshop(ctx.user, id));
  });

  // test rides
  route('POST', '/api/test-rides/holds', 'user', async (ctx) => ({ status: 201, body: await holdSlot(ctx.user, (await ctx.json())['slotId']) }));
  route('GET', '/api/test-rides', 'user', async (ctx) => ({ status: 200, body: { rides: await listRides(ctx.user) } }));
  route('GET', '/api/test-rides/:id', 'user', async (ctx) => ({ status: 200, body: await getRide(ctx.user, ctx.params['id']) }));
  route('POST', '/api/test-rides/:id/confirm', 'user', async (ctx) => ({ status: 200, body: await confirmRide(ctx.user, ctx.params['id']) }));
  route('POST', '/api/test-rides/:id/cancel', 'user', async (ctx) => ({ status: 200, body: await cancelRide(ctx.user, ctx.params['id']) }));

  // the fitter's desk
  route('GET', '/api/desk/orders', 'fitter', async () => ({ status: 200, body: { orders: await listDeskOrders() } }));
  route('GET', '/api/desk/orders/:id', 'fitter', async (ctx) => ({ status: 200, body: await loadDeskOrder(sql, uuidParam(ctx.params['id'])) }));
  route('POST', '/api/desk/orders/:id/refunds', 'fitter', async (ctx) => {
    const id = uuidParam(ctx.params['id']);
    const body = await ctx.json();
    const key = keyOf(ctx.header('idempotency-key'));
    return idempotent(ctx.user.id, key, fingerprint('POST', ctx.req.url ?? '', body), async () => { if (!(await orderRow(sql, id))) throw notFound(); },
      (usable) => requestRefund(ctx.user, id, body, usable));
  });
  route('POST', '/api/desk/orders/:id/transitions', 'fitter', async (ctx) => ({ status: 200, body: await transition(uuidParam(ctx.params['id']), (await ctx.json())['to']) }));
  route('POST', '/api/desk/orders/:id/delivered', 'fitter', async (ctx) => ({ status: 200, body: await recordDelivery(uuidParam(ctx.params['id']), (await ctx.json())['deliveredOn']) }));
  route('POST', '/api/desk/orders/:id/inspection', 'fitter', async (ctx) => ({ status: 200, body: await recordInspection(uuidParam(ctx.params['id'])) }));
  route('POST', '/api/desk/ride-days', 'fitter', async (ctx) => ({ status: 201, body: { slots: await openSlots(await ctx.json()) } }));
  route('GET', '/api/desk/rides', 'fitter', async (ctx) => ({ status: 200, body: { rides: await ridesOn(ctx.query.get('date')) } }));
  route('POST', '/api/desk/rides/:id/outcome', 'fitter', async (ctx) => ({ status: 200, body: await markOutcome(ctx.params['id'], (await ctx.json())['outcome']) }));

  // Kill Bill's callback: a delivery is believed only through a fresh read of the payment
  route('POST', '/api/killbill/notifications/:secret', 'none', async (ctx) => {
    const expected = Buffer.from(await callbackSecret());
    const given = Buffer.from(ctx.params['secret']);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw notFound();
    let body: unknown;
    try {
      body = JSON.parse((await ctx.raw()).toString('utf8'));
    } catch {
      throw fail(400, 'bad_notification');
    }
    if (!isRecord(body)) throw fail(400, 'bad_notification');
    try {
      await handleNotification(body);
    } catch (error) {
      if (error instanceof KillBillUnreachable) throw fail(503, 'provider_unreachable');
      throw error;
    }
    return { status: 200, body: { status: 'ok' } };
  }, { exemptOrigin: true });
}

