import express, { type Request, type Response, type NextFunction, type Express } from 'express';
import cookieParser from 'cookie-parser';
import { config, businessClock } from './config.js';
import { apiError, errorBody, sendError, asyncHandler, ApiError } from './errors.js';
import { query } from './db.js';
import * as redis from './holds.js';
import { takeHold, holdRemainingMs, releaseHold } from './holds.js';
import {
  EDITION_SIZE, BOX_GROSS_ORE, BOX_NET_ORE, COURIER_ORE, ORDER_TOTAL_ORE,
  CHARITY_NAME, SEED_RATE_BPS, plateFor, seedSplit, PLATES,
} from './edition.js';
import { allBoxes, publicBoxState, remainingStock } from './orders.js';
import { addShelfClient, publishSales } from './shelfHub.js';
import { doCheckout, CheckoutBody, copenhagenIso, sendAuthorisationNotice } from './checkout.js';
import { verifySignature, applyCallback, CallbackBody } from './callbacks.js';
import * as gw from './gateway.js';
import { pack, backOnShelf, refund, refundRemainder } from './pack.js';
import { ledgerFor, charityRates, scheduleRate, issueStatement, statements } from './ledger.js';
import * as bus from './bus.js';
import { staffSearchFallback } from './indexer.js';
import { searchPublic, searchUp } from './search.js';
import { staffAuth, login, callback, logout } from './oauth.js';
import * as store from './storage.js';
import { remaining, thresholds } from './stock.js';
import { extname, join, normalize, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const JSON_LIMIT = 64_000;
const ART_LIMIT = 5_100_000;

export function buildApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(cookieParser());
  app.use(express.json({ limit: JSON_LIMIT, type: ['application/json'], verify: (req, _res, buf) => {
    (req as Request & { rawBody?: Buffer }).rawBody = buf;
  } }));

  // A state-changing request from another site is refused.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    const stateChanging = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (origin && stateChanging && !isOwnOrigin(origin, req.headers.host)) {
      res.status(403).json(errorBody('origin_refused'));
      return;
    }
    next();
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if ((err as { type?: string }).type === 'entity.too.large') {
      res.status(413).json(errorBody('body_too_large'));
      return;
    }
    if ((err as { type?: string }).type === 'entity.unsupported.media.type') {
      res.status(415).json(errorBody('unsupported_media_type'));
      return;
    }
    if ((err instanceof SyntaxError) && 'body' in (err as object)) {
      res.status(415).json(errorBody('unsupported_media_type'));
      return;
    }
    res.status(500).json(errorBody('not_found'));
  });

  // ---------- Public edition and shelf ----------

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/edition', asyncHandler(async (_req, res) => {
    const split = seedSplit();
    const closed = businessClock.nowMs() >= Date.parse('2027-02-01T00:00:00+01:00');
    res.json({
      edition: EDITION_SIZE,
      priceOre: ORDER_TOTAL_ORE,
      netOre: BOX_NET_ORE,
      vatOre: BOX_GROSS_ORE - BOX_NET_ORE,
      courierOre: COURIER_ORE,
      totalOre: ORDER_TOTAL_ORE,
      charityName: CHARITY_NAME,
      rateBasisPoints: SEED_RATE_BPS,
      charityOre: split.charityOre,
      closesAt: '2027-02-01T00:00:00+01:00',
      salesOpen: !closed,
    });
  }));

  app.get('/api/shelf', asyncHandler(async (_req, res) => {
    const paused = !(await redis.redisUp());
    const boxes = await allBoxes();
    res.json({
      salesPaused: paused,
      remaining: await remainingStock(),
      boxes: boxes.map((b) => ({ number: b.number, plate: b.plate, state: publicBoxState(b.box_state) })),
    });
  }));

  app.get('/api/shelf/events', (_req, res) => {
    addShelfClient(res);
  });

  app.get('/api/boxes/:number', asyncHandler(async (req, res) => {
    const n = Number(req.params.number);
    if (!Number.isInteger(n) || n < 1 || n > EDITION_SIZE) throw apiError(404, 'not_found');
    const rows = await query<{ plate: string; box_state: string }>('SELECT plate, box_state FROM boxes WHERE number = $1', [n]);
    if (rows.length === 0) throw apiError(404, 'not_found');
    const art = await query<{ object_key: string }>('SELECT object_key FROM plate_art WHERE plate = $1', [rows[0].plate]);
    res.json({
      number: n,
      plate: rows[0].plate,
      state: publicBoxState(rows[0].box_state),
      artUrl: art.length > 0 ? `/api/plates/${rows[0].plate}/art` : null,
    });
  }));

  app.get('/api/plates/:plate/art', asyncHandler(async (req, res) => {
    const plate = req.params.plate.toLowerCase();
    const rows = await query<{ object_key: string; content_type: string }>('SELECT object_key, content_type FROM plate_art WHERE plate = $1', [plate]);
    if (rows.length === 0) throw apiError(404, 'not_found');
    try {
      const obj = await store.getObject(rows[0].object_key);
      if (!obj) throw apiError(404, 'not_found');
      res.setHeader('content-type', obj.contentType ?? rows[0].content_type);
      res.setHeader('x-content-type-options', 'nosniff');
      res.send(obj.body);
    } catch {
      throw apiError(503, 'storage_unreachable');
    }
  }));

  // ---------- Holds ----------

  app.post('/api/holds', asyncHandler(async (req, res) => {
    if (!(await redis.redisUp())) throw apiError(503, 'sales_paused');
    const number = Number(req.body?.number);
    if (!Number.isInteger(number) || number < 1 || number > EDITION_SIZE) {
      throw apiError(422, 'validation_failed');
    }
    if (businessClock.nowMs() >= Date.parse('2027-02-01T00:00:00+01:00')) {
      throw apiError(409, 'edition_closed');
    }
    const state = await query<{ box_state: string }>('SELECT box_state FROM boxes WHERE number = $1', [number]);
    if (state.length === 0) throw apiError(404, 'not_found');
    if (state[0].box_state !== 'available') {
      const taken = !['held', 'available'].includes(state[0].box_state);
      throw apiError(409, taken ? 'box_taken' : 'box_held');
    }
    // The same browser session asking again gets its own hold back, unchanged.
    const existingToken = req.headers['x-hold-token'] as string | undefined;
    if (existingToken) {
      const current = await redis.holdToken(number);
      if (current === existingToken) {
        const rem = await holdRemainingMs(number);
        res.status(200).json({ number, plate: plateFor(number), holdToken: current, holdMs: config.holdSeconds * 1000, remainingMs: rem ?? 0 });
        return;
      }
    }
    const token = crypto.randomUUID();
    const hold = await takeHold(number, token);
    if (!hold) {
      const state2 = await query<{ box_state: string }>('SELECT box_state FROM boxes WHERE number = $1', [number]);
      const taken = state2.length > 0 && !['held', 'available'].includes(state2[0].box_state);
      throw apiError(409, taken ? 'box_taken' : 'box_held');
    }
    // Update the box state for staff views and stock.
    await query("UPDATE boxes SET box_state = 'held' WHERE number = $1 AND box_state = 'available'", [number]);
    const { publishBox } = await import('./shelfHub.js');
    publishBox(number, 'held');
    publishSalesState();
    res.status(201).json({
      number,
      plate: plateFor(number),
      holdToken: token,
      holdMs: config.holdSeconds * 1000,
      remainingMs: config.holdSeconds * 1000,
    });
  }));

  app.get('/api/holds/:number', asyncHandler(async (req, res) => {
    if (!(await redis.redisUp())) throw apiError(503, 'sales_paused');
    const number = Number(req.params.number);
    const token = req.headers['x-hold-token'] as string | undefined;
    const current = await redis.holdToken(number);
    if (current === null || current === undefined) throw apiError(410, 'hold_ended');
    if (!token || token !== current) throw apiError(403, 'hold_not_yours');
    const rem = await holdRemainingMs(number);
    res.json({ number, state: 'held', holdMs: config.holdSeconds * 1000, remainingMs: rem ?? 0 });
  }));

  app.delete('/api/holds/:number', asyncHandler(async (req, res) => {
    if (!(await redis.redisUp())) throw apiError(503, 'sales_paused');
    const number = Number(req.params.number);
    const token = req.headers['x-hold-token'] as string | undefined;
    const released = await releaseHold(number, token ?? '');
    if (!released) {
      const current = await redis.holdToken(number);
      if (current === null) throw apiError(410, 'hold_ended');
      throw apiError(403, 'hold_not_yours');
    }
    await query("UPDATE boxes SET box_state = 'available' WHERE number = $1 AND box_state = 'held'", [number]);
    const { publishBox } = await import('./shelfHub.js');
    publishBox(number, 'available');
    publishSalesState();
    res.status(204).end();
  }));

  // ---------- Checkout and orders ----------

  app.post('/api/checkout', asyncHandler(async (req, res) => {
    const key = req.headers['idempotency-key'] as string | undefined;
    if (!key) throw apiError(422, 'validation_failed');
    const holdToken = req.headers['x-hold-token'] as string | undefined;
    if (!holdToken) throw apiError(403, 'hold_not_yours');
    if (!(await redis.redisUp())) throw apiError(503, 'sales_paused');
    const body = req.body as CheckoutBody;
    const bodyHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const result = await doCheckout(body, holdToken, key, bodyHash);
    res.status(result.status).json(result.reply);
  }));

  app.post('/api/checkout/:reference/challenge', asyncHandler(async (req, res) => {
    const reference = req.params.reference;
    const rows = await query<{ challenge_id: string; reference: string; expires_at: Date; payment_id: string }>(
      'SELECT challenge_id, reference, expires_at, payment_id FROM challenge_attempts WHERE reference = $1',
      [reference],
    );
    if (rows.length === 0) throw apiError(404, 'not_found');
    const challenge = rows[0];
    if (new Date(challenge.expires_at).getTime() < Date.now()) {
      throw apiError(410, 'challenge_expired');
    }
    // The hold's end caps the challenge.
    const order = await query<{ number: number; box_state: string }>('SELECT number, box_state FROM orders WHERE reference = $1', [reference]);
    if (order.length === 0 || order[0].box_state !== 'claimed') {
      const holdAlive = await redis.holdToken(order[0]?.number ?? 0);
      if (holdAlive === null) throw apiError(410, 'hold_ended');
    }
    const cancel = req.body?.cancel === true;
    try {
      if (cancel) {
        const reply = await gw.voidPayment(challenge.payment_id, `void-${reference}`);
        if (reply.status !== 200) throw apiError(503, 'gateway_unreachable');
        await query("DELETE FROM challenge_attempts WHERE reference = $1", [reference]);
        await query("UPDATE orders SET payment_state = 'declined' WHERE reference = $1 AND payment_state = 'challenge'", [reference]);
        throw apiError(402, 'challenge_cancelled', { reference, orderToken: (await orderTokenOf(reference)), paymentState: 'declined', boxState: 'held', holdRemainingMs: await holdRemainingMs(order[0].number) });
      }
      const code = String(req.body?.code ?? '');
      const reply = await gw.answerChallenge(challenge.challenge_id, code, `challenge-${reference}`);
      if (reply.status === 200 && reply.body?.status === 'authorised') {
        await query("DELETE FROM challenge_attempts WHERE reference = $1", [reference]);
        await query("UPDATE orders SET payment_state = 'authorised' WHERE reference = $1 AND payment_state = 'challenge'", [reference]);
        const orderRow = await query<{ buyer_email: string; number: number; payment_state: string; box_state: string }>(
          'SELECT buyer_email, number, payment_state, box_state FROM orders WHERE reference = $1', [reference]);
        try {
          await sendAuthorisationNotice(orderRow[0].number, reference, orderRow[0].buyer_email);
        } catch { /* retried */ }
        const rem = await holdRemainingMs(orderRow[0].number);
        res.json({
          reference,
          orderToken: await orderTokenOf(reference),
          paymentState: 'authorised',
          boxState: 'claimed',
          holdRemainingMs: rem,
        });
        return;
      }
      // The bank could not confirm.
      await query("UPDATE orders SET payment_state = 'declined' WHERE reference = $1", [reference]);
      throw apiError(402, reply.body?.declineCode ?? 'challenge_failed', {
        reference, orderToken: await orderTokenOf(reference), paymentState: 'declined', boxState: 'held',
        holdRemainingMs: await holdRemainingMs(order[0].number),
      });
    } catch (err) {
      if ((err as ApiError).code === 'gateway_unreachable' || (err as ApiError).status === 503) {
        throw apiError(503, 'gateway_unreachable');
      }
      throw err;
    }
  }));

  app.get('/api/orders/:reference', asyncHandler(async (req, res) => {
    const token = orderTokenOfRequest(req);
    const rows = await query<Record<string, unknown>>('SELECT * FROM orders WHERE reference = $1', [req.params.reference]);
    if (rows.length === 0) throw apiError(404, 'not_found');
    const o = rows[0] as unknown as {
      order_token: string; number: number; plate: string; method: string; payment_state: string;
      box_state: string; total_ore: number; charity_ore: number; certificate_state: string;
      transfer_iban: string | null; transfer_reference: string | null; transfer_deadline_at: Date | null;
    };
    if (!token || token !== o.order_token) throw apiError(404, 'not_found');
    res.json({
      reference: req.params.reference,
      number: o.number,
      plate: o.plate,
      method: o.method,
      paymentState: o.payment_state,
      boxState: o.box_state,
      totalOre: o.total_ore,
      charityOre: o.charity_ore,
      transfer: o.transfer_iban ? {
        iban: o.transfer_iban,
        paymentReference: o.transfer_reference,
        amountOre: o.total_ore,
        deadlineAt: copenhagenIso(new Date(o.transfer_deadline_at!)),
      } : null,
      certificate: { state: o.certificate_state },
    });
  }));

  app.post('/api/orders/lookup', asyncHandler(async (req, res) => {
    const reference = String(req.body?.reference ?? '');
    const email = String(req.body?.email ?? '').toLowerCase();
    const client = req.socket.remoteAddress ?? 'unknown';
    const limited = await lookupLimited(client);
    if (limited) {
      res.setHeader('Retry-After', String(await lookupRetryAfter(client)));
      res.status(429).json(errorBody('lookup_limited'));
      return;
    }
    const rows = await query<{ reference: string; order_token: string }>(
      'SELECT reference, order_token FROM orders WHERE reference = $1 AND lower(buyer_email) = $2',
      [reference, email],
    );
    if (rows.length === 0) {
      await countLookupRefusal(client);
      throw apiError(404, 'lookup_refused');
    }
    res.json({ reference: rows[0].reference, orderToken: rows[0].order_token });
  }));

  app.get('/api/orders/:reference/certificate', asyncHandler(async (req, res) => {
    const token = orderTokenOfRequest(req);
    const rows = await query<{ order_token: string; certificate_state: string; certificate_key: string | null }>(
      'SELECT order_token, certificate_state, certificate_key FROM orders WHERE reference = $1', [req.params.reference]);
    if (rows.length === 0 || !token || token !== rows[0].order_token) throw apiError(404, 'not_found');
    if (rows[0].certificate_state === 'cancelled') throw apiError(410, 'certificate_cancelled');
    if (rows[0].certificate_state !== 'issued' || !rows[0].certificate_key) throw apiError(409, 'certificate_pending');
    try {
      const obj = await store.getObject(rows[0].certificate_key);
      if (!obj) throw apiError(404, 'not_found');
      res.setHeader('content-type', 'application/pdf');
      res.setHeader('x-content-type-options', 'nosniff');
      res.send(obj.body);
    } catch (err) {
      if ((err as ApiError).code) throw err;
      throw apiError(503, 'storage_unreachable');
    }
  }));

  app.get('/api/search', asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? '');
    if (q.length === 0) {
      res.json({ hits: [] });
      return;
    }
    if (!(await searchUp())) throw apiError(503, 'search_unreachable');
    const { hits } = await searchPublic(q);
    res.json({ hits });
  }));

  app.get('/api/statements/:id/pdf', asyncHandler(async (req, res) => {
    const token = String(req.query.token ?? '');
    const rows = await query<{ object_key: string; token: string }>('SELECT object_key, token FROM statements WHERE id = $1', [req.params.id]);
    if (rows.length === 0 || token !== rows[0].token) throw apiError(404, 'not_found');
    try {
      const obj = await store.getObject(rows[0].object_key);
      if (!obj) throw apiError(404, 'not_found');
      res.setHeader('content-type', 'application/pdf');
      res.setHeader('x-content-type-options', 'nosniff');
      res.send(obj.body);
    } catch (err) {
      if ((err as ApiError).code) throw err;
      throw apiError(503, 'storage_unreachable');
    }
  }));

  // ---------- Gateway callback ----------

  app.post('/api/gateway/callbacks', asyncHandler(async (req, res) => {
    const raw = (req as Request & { rawBody?: Buffer }).rawBody?.toString('utf8')
      ?? (Buffer.isBuffer(req.body) ? req.body.toString('utf8') : (req.body ? JSON.stringify(req.body) : ''));
    if (!verifySignature(raw, req.headers['x-gateway-signature'] as string | undefined)) {
      res.status(401).json(errorBody('bad_signature'));
      return;
    }
    let body: CallbackBody;
    try {
      body = JSON.parse(raw);
    } catch {
      res.status(415).json(errorBody('unsupported_media_type'));
      return;
    }
    const status = await applyCallback(body);
    switch (status) {
      case 'not_found':
        res.status(404).json(errorBody('not_found'));
        break;
      case 'duplicate':
        res.json({ status: 'duplicate' });
        break;
      case 'ignored':
        res.json({ status: 'ignored' });
        break;
      case 'waiting':
        res.json({ status: 'waiting' });
        break;
      default:
        res.json({ status: 'applied' });
    }
  }));

  // ---------- Auth ----------

  app.get('/auth/login', asyncHandler(async (req, res) => { await login(req, res); }));
  app.get('/auth/callback', asyncHandler(async (req, res) => { await callback(req, res); }));
  app.post('/auth/logout', (_req, res) => { logout(_req, res); });

  // ---------- Staff, any role ----------

  app.get('/api/staff/me', asyncHandler(async (req, res) => {
    const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined;
    const cookie = req.cookies?.['press_staff'] as string | undefined;
    const { identityFromToken } = await import('./identity.js');
    const identity = await identityFromToken(bearer ?? cookie);
    if (!identity) throw apiError(401, 'sign_in_required');
    res.json({ username: identity.username, roles: identity.roles });
  }));

  app.get('/api/staff/search', staffAuth(), asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? '');
    if (await searchUp()) {
      const { searchStaff } = await import('./search.js');
      const { hits } = await searchStaff(q);
      res.json({ hits, degraded: false });
      return;
    }
    const hits = await staffSearchFallback(q);
    res.json({ hits, degraded: true });
  }));

  // ---------- Staff, packer ----------

  app.get('/api/staff/orders', staffAuth('packer'), asyncHandler(async (req, res) => {
    const filter = typeof req.query.boxState === 'string' ? req.query.boxState : null;
    const rows = await query<Record<string, unknown>>(
      filter
        ? 'SELECT * FROM orders WHERE box_state = $1 ORDER BY created_at DESC'
        : 'SELECT * FROM orders ORDER BY created_at DESC',
      filter ? [filter] : [],
    );
    res.json({
      orders: rows.map((r) => ({
        reference: r.reference,
        number: r.number,
        plate: r.plate,
        recipientName: (r.gift_recipient_name ?? r.buyer_name) as string,
        address: { street: r.address_street, postcode: r.address_postcode, city: r.address_city },
        boxState: r.box_state,
        paymentState: r.payment_state,
        trackingCode: r.tracking_code,
      })),
    });
  }));

  app.post('/api/staff/orders/:reference/pack', staffAuth('packer'), asyncHandler(async (req, res) => {
    const result = await pack(req.params.reference);
    res.status(202).json(result);
  }));

  app.post('/api/staff/boxes/:number/back-on-shelf', staffAuth('packer'), asyncHandler(async (req, res) => {
    const result = await backOnShelf(Number(req.params.number));
    res.json(result);
  }));

  app.get('/api/staff/dead-letters', staffAuth('packer'), asyncHandler(async (_req, res) => {
    try {
      res.json({ events: await bus.deadLetters() });
    } catch {
      throw apiError(503, 'queue_unreachable');
    }
  }));

  app.post('/api/staff/dead-letters/:eventId/retry', staffAuth('packer'), asyncHandler(async (req, res) => {
    try {
      const found = await bus.retryDeadLetter(req.params.eventId);
      if (!found) throw apiError(404, 'not_found');
      res.status(202).json({ eventId: req.params.eventId, status: 'requeued' });
    } catch (err) {
      if ((err as ApiError).code) throw err;
      throw apiError(503, 'queue_unreachable');
    }
  }));

  app.post('/api/staff/dead-letters/:eventId/dismiss', staffAuth('packer'), asyncHandler(async (req, res) => {
    const note = String(req.body?.note ?? '');
    if (!note.trim() || note.length > 280) throw apiError(422, 'dismissal_note_required');
    try {
      const ok = await bus.dismissDeadLetter(req.params.eventId);
      if (!ok) throw apiError(404, 'not_found');
      await query('INSERT INTO dismissed_events (event_id, note) VALUES ($1,$2) ON CONFLICT (event_id) DO NOTHING', [req.params.eventId, note]);
      res.json({ eventId: req.params.eventId, status: 'dismissed' });
    } catch (err) {
      if ((err as ApiError).code) throw err;
      throw apiError(503, 'queue_unreachable');
    }
  }));

  // ---------- Staff, treasurer ----------

  app.get('/api/staff/ledger/orders', staffAuth('treasurer'), asyncHandler(async (_req, res) => {
    const rows = await query<Record<string, unknown>>('SELECT reference, number, payment_state, box_state, gross_ore, rate_bps FROM orders ORDER BY created_at DESC');
    res.json({
      orders: rows.map((r) => ({
        reference: r.reference,
        number: r.number,
        paymentState: r.payment_state,
        boxState: r.box_state,
        grossOre: r.gross_ore,
        rateBasisPoints: r.rate_bps,
      })),
    });
  }));

  app.get('/api/staff/orders/:reference/ledger', staffAuth('treasurer'), asyncHandler(async (req, res) => {
    const body = await ledgerFor(req.params.reference);
    res.json(body);
  }));

  app.post('/api/staff/orders/:reference/refunds', staffAuth('treasurer'), asyncHandler(async (req, res) => {
    const key = req.headers['idempotency-key'] as string | undefined;
    if (!key) throw apiError(422, 'validation_failed');
    const amountOre = Number(req.body?.amountOre);
    const bodyHash = createHash('sha256').update(JSON.stringify({ amountOre: Number.isFinite(amountOre) ? amountOre : null })).digest('hex');
    const result = await refund(req.params.reference, amountOre, key, bodyHash);
    res.status(202).json(result);
  }));

  app.get('/api/staff/orders/:reference/refund-remainder', staffAuth('treasurer'), asyncHandler(async (req, res) => {
    res.json({ amountOre: await refundRemainder(req.params.reference) });
  }));

  app.get('/api/staff/charity-rates', staffAuth('treasurer'), asyncHandler(async (_req, res) => {
    res.json({ rates: await charityRates() });
  }));

  app.post('/api/staff/charity-rates', staffAuth('treasurer'), asyncHandler(async (req, res) => {
    const rate = Number(req.body?.rateBasisPoints);
    const from = String(req.body?.effectiveFrom ?? '');
    const row = await scheduleRate(rate, from);
    res.status(201).json(row);
  }));

  app.get('/api/staff/statements', staffAuth('treasurer'), asyncHandler(async (_req, res) => {
    res.json({ statements: await statements() });
  }));

  app.post('/api/staff/statements', staffAuth('treasurer'), asyncHandler(async (req, res) => {
    const month = String(req.body?.month ?? '');
    const result = await issueStatement(month);
    res.status(201).json(result);
  }));

  app.get('/api/staff/statements/:id/pdf', staffAuth('treasurer'), asyncHandler(async (req, res) => {
    const rows = await query<{ object_key: string }>('SELECT object_key FROM statements WHERE id = $1', [req.params.id]);
    if (rows.length === 0) throw apiError(404, 'not_found');
    try {
      const obj = await store.getObject(rows[0].object_key);
      if (!obj) throw apiError(404, 'not_found');
      res.setHeader('content-type', 'application/pdf');
      res.setHeader('x-content-type-options', 'nosniff');
      res.send(obj.body);
    } catch (err) {
      if ((err as ApiError).code) throw err;
      throw apiError(503, 'storage_unreachable');
    }
  }));

  app.put('/api/staff/charity-endpoint', staffAuth('treasurer'), asyncHandler(async (req, res) => {
    const url = String(req.body?.url ?? '');
    if (!/^https?:\/\/.+\..+/.test(url)) throw apiError(422, 'endpoint_invalid');
    const { setEndpoint } = await import('./webhooks.js');
    await setEndpoint(url);
    await query("INSERT INTO app_settings (key, value) VALUES ('charity_endpoint', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [url]);
    res.json({ url });
  }));

  app.get('/api/staff/deliveries', staffAuth('treasurer'), asyncHandler(async (_req, res) => {
    const { deliveries } = await import('./webhooks.js');
    try {
      const rows = await deliveries();
      res.json({ deliveries: rows });
    } catch {
      throw apiError(503, 'deliveries_unreachable');
    }
  }));

  // ---------- Staff, maker ----------

  app.post('/api/staff/plates/:plate/art', staffAuth('maker'), express.raw({ type: 'multipart/form-data', limit: ART_LIMIT }), asyncHandler(async (req, res) => {
    const plate = req.params.plate.toLowerCase();
    if (!(PLATES as readonly string[]).includes(plate)) throw apiError(404, 'not_found');
    const contentType = req.headers['content-type'] ?? '';
    const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
    if (!m) throw apiError(415, 'art_wrong_type');
    const boundary = (m[1] ?? m[2]).trim();
    const file = extractMultipartFile(req.body as Buffer, boundary);
    if (!file) throw apiError(422, 'validation_failed');
    // Type is judged from the file's leading bytes only.
    const kind = sniffImage(file.bytes);
    if (!kind) throw apiError(415, 'art_wrong_type');
    if (file.bytes.length > 5_000_000) throw apiError(413, 'art_too_large');
    const dims = imageDimensions(file.bytes, kind);
    if (dims.width > 6000 || dims.height > 6000) throw apiError(422, 'art_too_many_pixels');
    const ext = kind === 'image/png' ? 'png' : 'jpg';
    const objectKey = `plates/${plate}/${crypto.randomUUID()}.${ext}`;
    try {
      await store.putObject(objectKey, file.bytes, kind);
    } catch {
      throw apiError(503, 'storage_unreachable');
    }
    await query(
      `INSERT INTO plate_art (plate, object_key, content_type, bytes, width, height)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (plate) DO UPDATE SET object_key = EXCLUDED.object_key, content_type = EXCLUDED.content_type,
         bytes = EXCLUDED.bytes, width = EXCLUDED.width, height = EXCLUDED.height, uploaded_at = now()`,
      [plate, objectKey, kind, file.bytes.length, dims.width, dims.height],
    );
    res.status(201).json({ plate, artUrl: `/api/plates/${plate}/art`, bytes: file.bytes.length, width: dims.width, height: dims.height });
  }));

  app.get('/api/staff/stock', staffAuth('maker'), asyncHandler(async (_req, res) => {
    res.json({ remaining: await remaining(), thresholds: await thresholds() });
  }));

  app.get('/api/staff/status', staffAuth(), asyncHandler(async (_req, res) => {
    const pending = await query<{ n: number }>('SELECT count(*)::int AS n FROM pending_events WHERE published = FALSE');
    const alertsWaiting = await query<{ n: number }>('SELECT count(*)::int AS n FROM pending_alerts');
    res.json({
      eventsWaiting: pending[0].n > 0,
      alertsWaiting: alertsWaiting[0].n > 0,
    });
  }));

  // ---------- Error handling ----------

  // Static assets and the single-page app shell. Only built assets are
  // served; any path trying to climb out gets 404.
  const publicDir = resolve('public');
  const contentTypes: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.ttf': 'font/ttf',
    '.ogg': 'audio/ogg',
    '.json': 'application/json',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
  };
  const narrationDir = resolve('public/narration');

  app.get('/narration/:file', asyncHandler(async (req, res) => {
    const name = String(req.params.file);
    if (!/^([a-z]+)\.ogg$/.test(name)) throw apiError(404, 'not_found');
    const safe = join(narrationDir, name);
    if (!safe.startsWith(narrationDir)) throw apiError(404, 'not_found');
    try {
      const bytes = await readFile(safe);
      res.setHeader('content-type', 'audio/ogg');
      res.send(bytes);
    } catch {
      throw apiError(404, 'not_found');
    }
  }));

  app.use(asyncHandler(async (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { next(); return; }
    if (req.path.startsWith('/api/')) { next(); return; }
    let rel = normalize(req.path).replace(/^([/\\])+/, '');
    if (rel.includes('..')) { next(); return; }
    if (rel === '') rel = 'index.html';
    const target = join(publicDir, rel);
    if (!target.startsWith(publicDir)) { next(); return; }
    try {
      const bytes = await readFile(target);
      const ext = extname(target).toLowerCase();
      res.setHeader('content-type', contentTypes[ext] ?? 'application/octet-stream');
      res.setHeader('x-content-type-options', 'nosniff');
      res.send(bytes);
    } catch {
      // The app shell answers every known route.
      const shell = join(publicDir, 'index.html');
      try {
        const bytes = await readFile(shell);
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.setHeader('x-content-type-options', 'nosniff');
        res.send(bytes);
      } catch {
        next();
      }
    }
  }));

  app.use((_req, res) => {
    res.status(404).json(errorBody('not_found'));
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const apiErr = err as ApiError;
    if (apiErr && typeof apiErr.code === 'string') {
      sendError(res, apiErr);
      return;
    }
    console.error('unhandled:', err instanceof Error ? err.stack : err);
    res.status(500).json(errorBody('not_found'));
  });

  return app;
}

function isOwnOrigin(origin: string, hostHeader: string | undefined): boolean {
  try {
    const u = new URL(origin);
    // A same-origin request carries the page's own host in Origin and Host.
    if (hostHeader && u.host === hostHeader) return true;
    const own = new URL(config.appPublicUrl);
    return u.host === own.host;
  } catch {
    return false;
  }
}

/** Pull the file part out of a multipart body without trusting any header. */
function extractMultipartFile(body: Buffer, boundary: string): { bytes: Buffer } | null {
  const delim = Buffer.from(`--${boundary}`);
  let start = body.indexOf(delim);
  while (start !== -1) {
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), start);
    if (headerEnd === -1) return null;
    const next = body.indexOf(delim, headerEnd);
    const dataEnd = next === -1 ? body.length : next - 2; // drop the trailing CRLF
    const bytes = body.subarray(headerEnd + 4, dataEnd);
    return { bytes };
  }
  return null;
}

/** The type is judged from the file's leading bytes only. */
function sniffImage(bytes: Buffer): 'image/png' | 'image/jpeg' | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  return null;
}

/** Pixel size read from the file's own header. */
function imageDimensions(bytes: Buffer, kind: 'image/png' | 'image/jpeg'): { width: number; height: number } {
  if (kind === 'image/png') {
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    return { width, height };
  }
  // JPEG: walk the segments to the SOF marker.
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = bytes.readUInt16BE(i + 5);
      const width = bytes.readUInt16BE(i + 7);
      return { width, height };
    }
    const len = bytes.readUInt16BE(i + 2);
    i += 2 + len;
  }
  return { width: 0, height: 0 };
}

function orderTokenOfRequest(req: Request): string | null {
  const header = req.headers['x-order-token'] as string | undefined;
  if (header) return header;
  const q = req.query.token;
  if (typeof q === 'string') return q;
  return null;
}

async function orderTokenOf(reference: string): Promise<string> {
  const rows = await query<{ order_token: string }>('SELECT order_token FROM orders WHERE reference = $1', [reference]);
  return rows[0]?.order_token ?? '';
}

/** Refused lookup tries count against the connecting IP. */
async function countLookupRefusal(client: string): Promise<void> {
  const key = lookupKey(client);
  const multi = await import('./holds.js').then((m) => m.redis);
  const n = await multi.incr(key);
  if (n === 1) await multi.pexpire(key, config.lookupWindowSeconds * 1000);
}

async function lookupLimited(client: string): Promise<boolean> {
  const { redis } = await import('./holds.js');
  try {
    const n = await redis.get(lookupKey(client));
    return n !== null && Number(n) >= 5;
  } catch {
    // Valkey down: keep counting within the app.
    softCount[client] = (softCount[client] ?? 0) + 0;
    return false;
  }
}

const softCount: Record<string, number> = {};

async function lookupRetryAfter(client: string): Promise<number> {
  const { redis } = await import('./holds.js');
  const ttl = await redis.pttl(lookupKey(client));
  return Math.max(1, Math.ceil(ttl / 1000));
}

function lookupKey(client: string): string {
  return `lookup:${client}`;
}

function publishSalesState(): void {
  void redis.redisUp().then((up) => {
    publishSales(!up, businessClock.nowMs() < Date.parse('2027-02-01T00:00:00+01:00'));
  });
}
