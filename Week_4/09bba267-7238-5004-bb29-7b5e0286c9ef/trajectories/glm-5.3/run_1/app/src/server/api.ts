import type { Pool, PoolClient } from 'pg';
import type { RequestScope } from './http';
import { sendJson, newBuyerId, newToken, newOrderNumber, sha256, ownerCookieHeader } from './http';
import { ApiError, VALIDATION_MESSAGES, validateNameEmail, normalizeEmail } from './errors';
import {
  performanceById,
  performanceRows,
  buildPerformance,
  buildSeats,
  buildCart,
  buildOrder,
  buildEntry,
  buildOffer,
  ticketRows,
  orderRow,
  seatRows,
  tierRows,
  type EntryRow,
  type OfferRow,
  type OrderRow,
  type TicketRow,
} from './state';
import { ORDER_FEE_CENTS, seatFeeCents, formatCents } from './money';
import { compareSeatIds, isSeatId } from './hall';
import { freeSeat } from './seats';
import { ensureKillBillAccount, recordPurchase, recordExchangeTopUp, refundThroughKillBill } from './payments';
import { queueReceiptEmail, queueExchangeEmail, queueRefundEmail, ticketAmountCents } from './emails';
import { sweepExpiries } from './expiry';
import type { KillBillClient } from './killbill';
import type { Mailer } from './mailer';
import type { Order, Entry } from '../shared/api-types';

export type ApiDeps = {
  db: Pool;
  killbill: KillBillClient;
  mailer: Mailer;
  holdSeconds: number;
  offerSeconds: number;
};

const SEAT_LIMIT = 8;

export type Route = { method: string; pattern: RegExp; handler: (scope: RequestScope, deps: ApiDeps) => Promise<void> };

export function apiRoutes(): Route[] {
  return [
    { method: 'GET', pattern: /^\/api\/health$/, handler: getHealth },
    { method: 'GET', pattern: /^\/api\/performances$/, handler: listPerformances },
    { method: 'GET', pattern: /^\/api\/performances\/([^/]+)$/, handler: getPerformance },
    { method: 'GET', pattern: /^\/api\/performances\/([^/]+)\/seats$/, handler: getSeats },
    { method: 'GET', pattern: /^\/api\/performances\/([^/]+)\/cart$/, handler: getCart },
    { method: 'POST', pattern: /^\/api\/performances\/([^/]+)\/holds$/, handler: postHolds },
    { method: 'DELETE', pattern: /^\/api\/performances\/([^/]+)\/holds\/([^/]+)$/, handler: deleteHold },
    { method: 'POST', pattern: /^\/api\/performances\/([^/]+)\/checkout$/, handler: postCheckout },
    { method: 'POST', pattern: /^\/api\/performances\/([^/]+)\/tiers\/([^/]+)\/waitlist$/, handler: postWaitlist },
    { method: 'GET', pattern: /^\/api\/orders$/, handler: listOrders },
    { method: 'GET', pattern: /^\/api\/orders\/([^/]+)$/, handler: getOrder },
    { method: 'POST', pattern: /^\/api\/tickets\/([^/]+)\/exchange$/, handler: postExchange },
    { method: 'POST', pattern: /^\/api\/orders\/([^/]+)\/refunds$/, handler: postRefunds },
    { method: 'GET', pattern: /^\/api\/waitlist$/, handler: listWaitlist },
    { method: 'GET', pattern: /^\/api\/offers\/([^/]+)$/, handler: getOffer },
    { method: 'POST', pattern: /^\/api\/offers\/([^/]+)\/accept$/, handler: postAcceptOffer },
    { method: 'POST', pattern: /^\/api\/offers\/([^/]+)\/decline$/, handler: postDeclineOffer },
    { method: 'POST', pattern: /^\/api\/owner\/session$/, handler: postOwnerSession },
    { method: 'DELETE', pattern: /^\/api\/owner\/session$/, handler: deleteOwnerSession },
    { method: 'GET', pattern: /^\/api\/owner\/performances$/, handler: ownerPerformances },
    { method: 'POST', pattern: /^\/api\/owner\/performances$/, handler: ownerPublish },
    { method: 'GET', pattern: /^\/api\/owner\/orders$/, handler: ownerOrders },
    { method: 'GET', pattern: /^\/api\/owner\/outbox$/, handler: ownerOutbox },
    { method: 'GET', pattern: /^\/api\/events$/, handler: getEvents },
  ];
}

function buyerOf(scope: RequestScope): string {
  if (scope.buyerId) return scope.buyerId;
  const id = newBuyerId();
  scope.buyerId = id;
  scope.setBuyerCookie = true;
  return id;
}

async function getHealth(scope: RequestScope): Promise<void> {
  sendJson(scope.res, 200, { status: 'ok' });
}

async function listPerformances(scope: RequestScope, deps: ApiDeps): Promise<void> {
  const now = new Date();
  const rows = await performanceRows(deps.db);
  const performances = [];
  for (const row of rows) {
    performances.push(await buildPerformance(deps.db, row, now, false));
  }
  sendJson(scope.res, 200, { performances });
}

async function getPerformance(scope: RequestScope, deps: ApiDeps): Promise<void> {
  const row = await performanceById(deps.db, scope.url.pathname.split('/')[3]);
  if (!row) throw ApiError.notFound();
  const performance = await buildPerformance(deps.db, row, new Date(), false);
  sendJson(scope.res, 200, performance);
}

async function getSeats(scope: RequestScope, deps: ApiDeps): Promise<void> {
  const id = scope.url.pathname.split('/')[3];
  const row = await performanceById(deps.db, id);
  if (!row) throw ApiError.notFound();
  await sweepForPerformance(deps);
  const seats = await buildSeats(deps.db, id, buyerOf(scope));
  sendJson(scope.res, 200, { seats });
}

async function getCart(scope: RequestScope, deps: ApiDeps): Promise<void> {
  const id = scope.url.pathname.split('/')[3];
  const row = await performanceById(deps.db, id);
  if (!row) throw ApiError.notFound();
  await sweepForPerformance(deps);
  const cart = await buildCart(deps.db, id, buyerOf(scope), new Date());
  sendJson(scope.res, 200, cart);
}

async function sweepForPerformance(deps: ApiDeps): Promise<void> {
  await sweepExpiries({ db: deps.db, mailer: deps.mailer, offerSeconds: deps.offerSeconds });
}

async function postHolds(scope: RequestScope, deps: ApiDeps): Promise<void> {
  const performanceId = scope.url.pathname.split('/')[3];
  const buyerId = buyerOf(scope);
  const body = asObject(scope.bodyJson);
  const requested = body.seatIds;
  if (!Array.isArray(requested) || requested.some((id) => typeof id !== 'string')) {
    throw ApiError.validation({ seatIds: VALIDATION_MESSAGES.seatIdsRange });
  }
  const distinct = [...new Set(requested as string[])];
  if (distinct.length < 1 || distinct.length > 8 || distinct.length !== requested.length) {
    throw ApiError.validation({ seatIds: VALIDATION_MESSAGES.seatIdsRange });
  }
  const client = await deps.db.connect();
  try {
    await client.query('BEGIN');
    const performance = await performanceById(client, performanceId);
    if (!performance) {
      await client.query('ROLLBACK');
      throw ApiError.notFound();
    }
    const now = new Date();
    if (performance.starts_at.getTime() <= now.getTime()) {
      await client.query('ROLLBACK');
      throw ApiError.state(409, 'sales_closed');
    }
    await releaseExpiredHoldsFor(client, performanceId, buyerId, deps, now);

    const seatRowsResult = await client.query<{ seat_id: string; tier_id: string | null; state: string; hold_token: string | null }>(
      `SELECT seat_id, tier_id, state, hold_token FROM seats WHERE performance_id = $1 AND seat_id = ANY($2) FOR UPDATE`,
      [performanceId, distinct],
    );
    const bySeat = new Map(seatRowsResult.rows.map((row) => [row.seat_id, row]));
    const held: string[] = [];
    const taken: string[] = [];
    const alreadyMine = new Set<string>();
    for (const seatId of [...distinct].sort(compareSeatIds)) {
      const seat = bySeat.get(seatId);
      if (!seat || !seat.tier_id) {
        taken.push(seatId);
        continue;
      }
      if (seat.state === 'held' && seat.hold_token === buyerId) {
        alreadyMine.add(seatId);
        continue;
      }
      if (seat.state === 'on_sale') {
        held.push(seatId);
      } else {
        taken.push(seatId);
      }
    }
    if (held.length === 0) {
      await client.query('ROLLBACK');
      throw ApiError.state(409, 'seats_taken', { taken, cart: await buildCart(client, performanceId, buyerId, now) });
    }

    const existingHold = await client.query<{ expires_at: Date }>(
      'SELECT expires_at FROM holds WHERE performance_id = $1 AND buyer_id = $2 FOR UPDATE',
      [performanceId, buyerId],
    );
    const counting = held.filter((seatId) => !alreadyMine.has(seatId));
    const ticketsForBuyer = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM tickets t JOIN orders o ON o.id = t.order_id
       WHERE o.buyer_id = $1 AND t.performance_id = $2 AND o.status != 'cancelled'
       AND t.status IN ('issued','payment_pending','exchange_pending','refund_pending')`,
      [buyerId, performanceId],
    );
    const currentHeld = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM seats WHERE performance_id = $1 AND state = 'held' AND hold_token = $2`,
      [performanceId, buyerId],
    );
    const inUse = ticketsForBuyer.rows[0].count + currentHeld.rows[0].count;
    if (inUse + counting.length > SEAT_LIMIT) {
      await client.query('ROLLBACK');
      throw ApiError.validation({ seatIds: VALIDATION_MESSAGES.seatLimit });
    }

    let expiresAt = existingHold.rows[0]?.expires_at;
    if (!expiresAt) {
      expiresAt = new Date(now.getTime() + deps.holdSeconds * 1000);
      await client.query('INSERT INTO holds (performance_id, buyer_id, expires_at) VALUES ($1, $2, $3)', [
        performanceId,
        buyerId,
        expiresAt,
      ]);
    }
    for (const seatId of held) {
      await client.query(`UPDATE seats SET state = 'held', hold_token = $1 WHERE performance_id = $2 AND seat_id = $3`, [
        buyerId,
        performanceId,
        seatId,
      ]);
    }
    await client.query('COMMIT');
    const cart = await buildCart(deps.db, performanceId, buyerId, new Date());
    sendJson(scope.res, 200, { cart, held, taken });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* transaction already closed */
    }
    throw error;
  } finally {
    client.release();
  }
}

async function releaseExpiredHoldsFor(client: PoolClient, performanceId: string, buyerId: string, deps: ApiDeps, now: Date): Promise<void> {
  const hold = await client.query<{ expires_at: Date }>(
    'SELECT expires_at FROM holds WHERE performance_id = $1 AND buyer_id = $2 FOR UPDATE',
    [performanceId, buyerId],
  );
  const expiry = hold.rows[0]?.expires_at;
  if (!expiry || expiry.getTime() > now.getTime()) return;
  const performance = await performanceById(client, performanceId);
  const salesOpen = performance ? performance.starts_at.getTime() > now.getTime() : false;
  const seats = await client.query<{ seat_id: string }>(
    `SELECT seat_id FROM seats WHERE performance_id = $1 AND state = 'held' AND hold_token = $2 FOR UPDATE`,
    [performanceId, buyerId],
  );
  for (const seat of seats.rows) {
    await freeSeat(client, {
      performanceId,
      seatId: seat.seat_id,
      salesOpen,
      offerSeconds: deps.offerSeconds,
      now,
      mailer: deps.mailer,
    });
  }
  await client.query('DELETE FROM holds WHERE performance_id = $1 AND buyer_id = $2', [performanceId, buyerId]);
}

async function deleteHold(scope: RequestScope, deps: ApiDeps): Promise<void> {
  const parts = scope.url.pathname.split('/');
  const performanceId = parts[3];
  const seatId = parts[5];
  const buyerId = buyerOf(scope);
  const client = await deps.db.connect();
  try {
    await client.query('BEGIN');
    const performance = await performanceById(client, performanceId);
    if (!performance) {
      await client.query('ROLLBACK');
      throw ApiError.notFound();
    }
    await releaseExpiredHoldsFor(client, performanceId, buyerId, deps, new Date());
    const seat = await client.query<{ state: string; hold_token: string | null }>(
      'SELECT state, hold_token FROM seats WHERE performance_id = $1 AND seat_id = $2 FOR UPDATE',
      [performanceId, seatId],
    );
    if (!seat.rows[0] || seat.rows[0].state !== 'held' || seat.rows[0].hold_token !== buyerId) {
      await client.query('ROLLBACK');
      throw ApiError.notFound();
    }
    const now = new Date();
    const salesOpen = performance.starts_at.getTime() > now.getTime();
    await freeSeat(client, { performanceId, seatId, salesOpen, offerSeconds: deps.offerSeconds, now, mailer: deps.mailer });
    await client.query('COMMIT');
    const cart = await buildCart(deps.db, performanceId, buyerId, new Date());
    sendJson(scope.res, 200, { cart });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* transaction already closed */
    }
    throw error;
  } finally {
    client.release();
  }
}

async function postCheckout(scope: RequestScope, deps: ApiDeps): Promise<void> {
  const performanceId = scope.url.pathname.split('/')[3];
  const buyerId = buyerOf(scope);
  await runKeyed(scope, deps, { scope: 'buyer', buyerId, subkey: performanceId }, async (client, keyResult) => {
    const body = asObject(scope.bodyJson);
    const fields = validateNameEmail(body);
    if (Object.keys(fields).length > 0) {
      throw ApiError.validation(fields);
    }
    const name = String(body.name).trim();
    const email = String(body.email).trim();
    const now = new Date();
    const performance = await performanceById(client, performanceId);
    if (!performance) throw ApiError.notFound();
    if (performance.starts_at.getTime() <= now.getTime()) throw ApiError.state(409, 'sales_closed');
    await releaseExpiredHoldsFor(client, performanceId, buyerId, deps, now);

    const cart = await buildCart(client, performanceId, buyerId, now);
    if (cart.seats.length === 0) throw ApiError.state(409, 'cart_empty');

    const orderId = newOrderNumber();
    const account = await ensureKillBillAccount(deps.killbill, normalizeEmail(email), name);
    if (!account) throw ApiError.state(503, 'payments_unavailable');

    const orderResult = await client.query<OrderRow>(
      `INSERT INTO orders (id, performance_id, buyer_id, name, email, email_lower, status, face_cents, seat_fees_cents, order_fee_cents, total_cents, net_paid_cents, receipt, killbill_account_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending_payment', $7, $8, $9, $10, 0, NULL, $11)
       RETURNING *`,
      [
        orderId,
        performanceId,
        buyerId,
        name,
        email,
        normalizeEmail(email),
        cart.faceCents,
        cart.seatFeesCents,
        ORDER_FEE_CENTS,
        cart.totalCents,
        account,
      ],
    );
    const order = orderResult.rows[0];
    const ticketRows: TicketRow[] = [];
    for (const seat of cart.seats) {
      const ticketId = newToken('tk');
      await client.query(
        `INSERT INTO tickets (id, order_id, performance_id, seat_id, tier_id, tier_name, face_cents, seat_fee_cents, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'payment_pending')`,
        [ticketId, orderId, performanceId, seat.seatId, seat.tierId, seat.tierName, seat.faceCents, seat.seatFeeCents],
      );
      ticketRows.push({
        id: ticketId,
        seat_id: seat.seatId,
        tier_id: seat.tierId,
        tier_name: seat.tierName,
        face_cents: seat.faceCents,
        seat_fee_cents: seat.seatFeeCents,
        status: 'payment_pending',
      });
    }

    const payment = await recordPurchase(client, deps.killbill, { orderId, accountId: account, totalCents: cart.totalCents });
    if (payment.outcome === 'unavailable') {
      await client.query(`UPDATE orders SET status = 'cancelled', cancelled_at = now() WHERE id = $1`, [orderId]);
      throw ApiError.state(503, 'payments_unavailable');
    }
    if (payment.outcome === 'declined') {
      await client.query(`UPDATE orders SET status = 'cancelled', cancelled_at = now() WHERE id = $1`, [orderId]);
      for (const seat of cart.seats) {
        await freeSeat(client, {
          performanceId,
          seatId: seat.seatId,
          salesOpen: true,
          offerSeconds: deps.offerSeconds,
          now,
          mailer: deps.mailer,
        });
      }
      throw ApiError.state(402, 'payment_declined');
    }
    await finalizePaidOrder(client, { orderId, killbillAccountId: account, paymentId: payment.paymentId, tickets: ticketRows, order, performance });
    const refreshedOrder = (await client.query<OrderRow>('SELECT * FROM orders WHERE id = $1', [orderId])).rows[0];
    await queueReceiptEmail(client, deps.mailer, { order: refreshedOrder, tickets: ticketRows, performance });
    keyResult.setBody({ order: await buildOrder(client, refreshedOrder) }, 201);
  });
}

async function finalizePaidOrder(
  client: PoolClient,
  args: {
    orderId: string;
    killbillAccountId: string;
    paymentId: string;
    tickets: TicketRow[];
    order: OrderRow;
    performance: { id: string; title: string; starts_at: Date };
  },
): Promise<void> {
  for (const ticket of args.tickets) {
    await client.query(`UPDATE tickets SET status = 'issued' WHERE id = $1`, [ticket.id]);
    ticket.status = 'issued';
    await client.query(`UPDATE seats SET state = 'sold', hold_token = NULL WHERE performance_id = $1 AND seat_id = $2`, [
      args.order.performance_id,
      ticket.seat_id,
    ]);
  }
  await client.query(`UPDATE orders SET status = 'paid', net_paid_cents = total_cents, receipt = 'queued' WHERE id = $1`, [args.orderId]);
  await client.query(`DELETE FROM holds WHERE performance_id = $1 AND buyer_id = $2`, [args.order.performance_id, args.order.buyer_id]);
}

async function postWaitlist(scope: RequestScope, deps: ApiDeps): Promise<void> {
  const parts = scope.url.pathname.split('/');
  const performanceId = parts[3];
  const tierId = parts[5];
  const buyerId = buyerOf(scope);
  const body = asObject(scope.bodyJson);
  const fields = validateNameEmail(body);
  if (Object.keys(fields).length > 0) throw ApiError.validation(fields);
  const name = String(body.name).trim();
  const email = String(body.email).trim();
  const client = await deps.db.connect();
  try {
    await client.query('BEGIN');
    const performance = await performanceById(client, performanceId);
    if (!performance) throw ApiError.notFound();
    const now = new Date();
    if (performance.starts_at.getTime() <= now.getTime()) throw ApiError.state(409, 'sales_closed');
    const tier = (await tierRows(client, performanceId)).find((t) => t.id === tierId);
    if (!tier) throw ApiError.notFound();
    const seats = await seatRows(client, performanceId);
    const remaining = seats.filter((s) => s.tier_id === tierId && s.state === 'on_sale').length;
    if (remaining > 0) throw ApiError.state(409, 'tier_not_sold_out');
    const emailLower = normalizeEmail(email);
    const existing = await client.query<EntryRow>(
      `SELECT * FROM waitlist_entries WHERE performance_id = $1 AND tier_id = $2 AND email_lower = $3 AND status IN ('waiting','offered')`,
      [performanceId, tierId, emailLower],
    );
    if (existing.rows[0]) throw ApiError.state(409, 'already_waiting');
    const entryId = newToken('wl');
    await client.query(
      `INSERT INTO waitlist_entries (id, performance_id, tier_id, buyer_id, name, email, email_lower, status, joined_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'waiting', now())`,
      [entryId, performanceId, tierId, buyerId, name, email, emailLower],
    );
    const entryRow = (await client.query<EntryRow>('SELECT * FROM waitlist_entries WHERE id = $1', [entryId])).rows[0];
    await client.query('COMMIT');
    const entry = await buildEntry(deps.db, entryRow);
    sendJson(scope.res, 201, { entry });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* transaction already closed */
    }
    throw error;
  } finally {
    client.release();
  }
}

async function listOrders(scope: RequestScope, deps: ApiDeps): Promise<void> {
  const buyerId = buyerOf(scope);
  const result = await deps.db.query<OrderRow>(
    `SELECT * FROM orders WHERE buyer_id = $1 AND status != 'cancelled' ORDER BY created_at DESC, id DESC`,
    [buyerId],
  );
  const orders: Order[] = [];
  for (const row of result.rows) {
    orders.push(await buildOrder(deps.db, row));
  }
  sendJson(scope.res, 200, { orders });
}

async function getOrder(scope: RequestScope, deps: ApiDeps): Promise<void> {
  const orderId = scope.url.pathname.split('/')[3];
  const buyerId = buyerOf(scope);
  const order = await orderRow(deps.db, orderId);
  if (!order || order.buyer_id !== buyerId) throw ApiError.notFound();
  sendJson(scope.res, 200, await buildOrder(deps.db, order));
}

async function postExchange(scope: RequestScope, deps: ApiDeps): Promise<void> {
  const ticketId = scope.url.pathname.split('/')[3];
  const buyerId = buyerOf(scope);
  await runKeyed(scope, deps, { scope: 'buyer', buyerId, subkey: ticketId }, async (client) => {
    const body = asObject(scope.bodyJson);
    const newSeatId = body.newSeatId;
    if (typeof newSeatId !== 'string' || !isSeatId(newSeatId)) {
      throw ApiError.validation({ newSeatId: VALIDATION_MESSAGES.newSeatId });
    }
    const now = new Date();
    const ticketResult = await client.query<TicketRow & { buyer_id: string; performance_id: string; order_id: string }>(
      `SELECT t.*, o.buyer_id, o.performance_id, t.order_id FROM tickets t JOIN orders o ON o.id = t.order_id WHERE t.id = $1`,
      [ticketId],
    );
    const ticket = ticketResult.rows[0];
    if (!ticket || ticket.buyer_id !== buyerId) throw ApiError.notFound();
    const performance = await performanceById(client, ticket.performance_id);
    if (!performance) throw ApiError.notFound();
    if (performance.starts_at.getTime() - 24 * 3600_000 <= now.getTime()) throw ApiError.state(409, 'changes_closed');
    if (ticket.status !== 'issued') throw ApiError.state(409, 'ticket_not_issued');
    const order = await orderRow(client, ticket.order_id);
    if (!order) throw ApiError.notFound();

    const seat = await client.query<{ tier_id: string | null; state: string; hold_token: string | null }>(
      'SELECT tier_id, state, hold_token FROM seats WHERE performance_id = $1 AND seat_id = $2 FOR UPDATE',
      [ticket.performance_id, newSeatId],
    );
    const seatRow = seat.rows[0];
    if (!seatRow || !seatRow.tier_id || seatRow.state !== 'on_sale') {
      throw ApiError.state(409, 'seats_taken', { taken: [newSeatId] });
    }
    const tiers = await tierRows(client, ticket.performance_id);
    const newTier = tiers.find((t) => t.id === seatRow.tier_id);
    if (!newTier) throw ApiError.validation({ newSeatId: VALIDATION_MESSAGES.newSeatId });

    const differenceCents = newTier.face_cents + seatFeeCents(newTier.face_cents) - (ticket.face_cents + ticket.seat_fee_cents);
    await client.query(`UPDATE seats SET state = 'held', hold_token = $1 WHERE performance_id = $2 AND seat_id = $3`, [
      `exchange:${ticketId}`,
      ticket.performance_id,
      newSeatId,
    ]);
    await client.query(`UPDATE tickets SET status = 'exchange_pending' WHERE id = $1`, [ticketId]);
    
    let outcome: 'confirmed' | 'declined' | 'unavailable' = 'confirmed';
    if (differenceCents > 0) {
      const n = order.exchange_count + 1;
      const result = await recordExchangeTopUp(client, deps.killbill, {
        orderId: order.id,
        accountId: order.killbill_account_id ?? '',
        n,
        differenceCents,
      });
      outcome = result.outcome;
    } else if (differenceCents < 0) {
      const result = await refundThroughKillBill(client, deps.killbill, {
        orderId: order.id,
        accountId: order.killbill_account_id ?? '',
        amountCents: -differenceCents,
      });
      outcome = result.outcome;
    }
    if (outcome === 'unavailable') {
      await client.query(`UPDATE tickets SET status = 'issued' WHERE id = $1`, [ticketId]);
      await freeSeat(client, {
        performanceId: ticket.performance_id,
        seatId: newSeatId,
        salesOpen: true,
        offerSeconds: deps.offerSeconds,
        now,
        mailer: deps.mailer,
      });
      throw ApiError.state(503, 'payments_unavailable');
    }
    if (outcome === 'declined') {
      await client.query(`UPDATE tickets SET status = 'issued' WHERE id = $1`, [ticketId]);
      await freeSeat(client, {
        performanceId: ticket.performance_id,
        seatId: newSeatId,
        salesOpen: true,
        offerSeconds: deps.offerSeconds,
        now,
        mailer: deps.mailer,
      });
      throw ApiError.state(402, 'payment_declined');
    }
    await client.query(`UPDATE orders SET exchange_count = exchange_count + 1 WHERE id = $1`, [order.id]);
    await client.query(
      `UPDATE tickets SET seat_id = $1, tier_id = $2, tier_name = $3, face_cents = $4, seat_fee_cents = $5, status = 'issued' WHERE id = $6`,
      [newSeatId, newTier.id, newTier.name, newTier.face_cents, seatFeeCents(newTier.face_cents), ticketId],
    );
    await client.query(`UPDATE seats SET state = 'sold', hold_token = NULL WHERE performance_id = $1 AND seat_id = $2`, [
      ticket.performance_id,
      newSeatId,
    ]);
    const salesOpen = performance.starts_at.getTime() > now.getTime();
    await freeSeat(client, {
      performanceId: ticket.performance_id,
      seatId: ticket.seat_id,
      salesOpen,
      offerSeconds: deps.offerSeconds,
      now,
      mailer: deps.mailer,
    });
    const updatedOrder = await orderRow(client, order.id);
    if (updatedOrder) {
      await client.query(`UPDATE orders SET net_paid_cents = net_paid_cents + $2 WHERE id = $1`, [order.id, differenceCents]);
      await queueExchangeEmail(client, deps.mailer, {
        order: updatedOrder,
        oldSeatId: ticket.seat_id,
        newSeatId,
        differenceCents,
      });
    }
    const refreshed = await orderRow(client, order.id);
    if (refreshed) {
      sendJson(scope.res, 200, { order: await buildOrder(client, refreshed), differenceCents });
    }
  });
}

async function postRefunds(scope: RequestScope, deps: ApiDeps): Promise<void> {
  const orderId = scope.url.pathname.split('/')[3];
  const buyerId = buyerOf(scope);
  await runKeyed(scope, deps, { scope: 'buyer', buyerId, subkey: orderId }, async (client) => {
    const body = asObject(scope.bodyJson);
    const ticketIds = body.ticketIds;
    if (
      !Array.isArray(ticketIds) ||
      ticketIds.length === 0 ||
      ticketIds.some((id) => typeof id !== 'string') ||
      new Set(ticketIds as string[]).size !== ticketIds.length
    ) {
      throw ApiError.validation({ ticketIds: VALIDATION_MESSAGES.ticketIds });
    }
    const now = new Date();
    const order = await orderRow(client, orderId);
    if (!order || order.buyer_id !== buyerId) throw ApiError.notFound();
    const performance = await performanceById(client, order.performance_id);
    if (!performance) throw ApiError.notFound();
    if (performance.starts_at.getTime() - 24 * 3600_000 <= now.getTime()) throw ApiError.state(409, 'changes_closed');
    const tickets = await ticketRows(client, orderId);
    const requested = new Set(ticketIds as string[]);
    const target = tickets.filter((t) => requested.has(t.id));
    if (target.length === 0 || target.some((t) => t.status !== 'issued')) {
      throw ApiError.state(409, 'ticket_not_issued');
    }
    const remainingIssued = tickets.filter((t) => t.status === 'issued' && !requested.has(t.id)).length;
    const refundCents = target.reduce((sum, t) => sum + ticketAmountCents(t), 0) + (remainingIssued === 0 ? order.order_fee_cents : 0);

    for (const ticket of target) {
      await client.query(`UPDATE tickets SET status = 'refund_pending' WHERE id = $1`, [ticket.id]);
    }
    const result = await refundThroughKillBill(client, deps.killbill, {
      orderId: order.id,
      accountId: order.killbill_account_id ?? '',
      amountCents: refundCents,
    });
    if (result.outcome === 'unavailable') {
      for (const ticket of target) {
        await client.query(`UPDATE tickets SET status = 'issued' WHERE id = $1`, [ticket.id]);
      }
      throw ApiError.state(503, 'payments_unavailable');
    }
    if (result.outcome === 'declined') {
      for (const ticket of target) {
        await client.query(`UPDATE tickets SET status = 'issued' WHERE id = $1`, [ticket.id]);
      }
      throw ApiError.state(402, 'payment_declined');
    }
    for (const ticket of target) {
      await client.query(`UPDATE tickets SET status = 'refunded' WHERE id = $1`, [ticket.id]);
      const salesOpen = performance.starts_at.getTime() > now.getTime();
      await freeSeat(client, {
        performanceId: order.performance_id,
        seatId: ticket.seat_id,
        salesOpen,
        offerSeconds: deps.offerSeconds,
        now,
        mailer: deps.mailer,
      });
    }
    const updatedTickets = await ticketRows(client, orderId);
    const anyIssued = updatedTickets.some((t) => t.status === 'issued');
    const newStatus = anyIssued ? 'partially_refunded' : 'refunded';
    await client.query(`UPDATE orders SET status = $2, net_paid_cents = net_paid_cents - $3 WHERE id = $1`, [
      orderId,
      newStatus,
      refundCents,
    ]);
    await queueRefundEmail(client, deps.mailer, {
      order,
      tickets: target,
      refundCents,
      includesOrderFee: remainingIssued === 0,
    });
    const refreshed = await orderRow(client, orderId);
    if (refreshed) {
      sendJson(scope.res, 200, { order: await buildOrder(client, refreshed), refundCents });
    }
  });
}

async function listWaitlist(scope: RequestScope, deps: ApiDeps): Promise<void> {
  const buyerId = buyerOf(scope);
  const result = await deps.db.query<EntryRow>(
    'SELECT * FROM waitlist_entries WHERE buyer_id = $1 ORDER BY joined_at DESC, id DESC',
    [buyerId],
  );
  const entries: Entry[] = [];
  for (const row of result.rows) {
    entries.push(await buildEntry(deps.db, row));
  }
  sendJson(scope.res, 200, { entries });
}

async function getOffer(scope: RequestScope, deps: ApiDeps): Promise<void> {
  const token = scope.url.pathname.split('/')[3];
  await sweepForPerformance(deps);
  const result = await deps.db.query<OfferRow>('SELECT * FROM offers WHERE token = $1', [token]);
  const offer = result.rows[0];
  if (!offer) throw ApiError.notFound();
  const built = await buildOffer(deps.db, offer, new Date());
  if (!built) throw ApiError.notFound();
  sendJson(scope.res, 200, { offer: built });
}

async function postAcceptOffer(scope: RequestScope, deps: ApiDeps): Promise<void> {
  const token = scope.url.pathname.split('/')[3];
  const buyerId = buyerOf(scope);
  await runKeyed(scope, deps, { scope: 'offer', buyerId, subkey: token }, async (client) => {
    const now = new Date();
    const offerResult = await client.query<OfferRow>('SELECT * FROM offers WHERE token = $1 FOR UPDATE', [token]);
    const offer = offerResult.rows[0];
    if (!offer) throw ApiError.notFound();
    const entryResult = await client.query<EntryRow>('SELECT * FROM waitlist_entries WHERE id = $1 FOR UPDATE', [offer.entry_id]);
    const entry = entryResult.rows[0];
    if (!entry) throw ApiError.notFound();
    if (offer.status === 'accepted' || offer.status === 'declined') throw ApiError.state(409, 'offer_closed');
    if (offer.status === 'expired' || offer.expires_at.getTime() <= now.getTime()) {
      if (offer.status === 'open') {
        await client.query(`UPDATE offers SET status = 'expired' WHERE token = $1`, [token]);
        await client.query(`UPDATE waitlist_entries SET status = 'expired' WHERE id = $1 AND status = 'offered'`, [entry.id]);
        const salesOpen = (await performanceById(client, offer.performance_id))!.starts_at.getTime() > now.getTime();
        await client.query(`UPDATE seats SET state = 'held', hold_token = 'offer-expire' WHERE performance_id = $1 AND seat_id = $2 AND state = 'offered'`, [
          offer.performance_id,
          offer.seat_id,
        ]);
        await freeSeat(client, {
          performanceId: offer.performance_id,
          seatId: offer.seat_id,
          salesOpen,
          offerSeconds: deps.offerSeconds,
          now,
          mailer: deps.mailer,
        });
      }
      throw ApiError.state(410, 'offer_expired');
    }
    const performance = await performanceById(client, offer.performance_id);
    if (!performance) throw ApiError.notFound();
    if (performance.starts_at.getTime() <= now.getTime()) throw ApiError.state(409, 'sales_closed');

    const tiers = await tierRows(client, offer.performance_id);
    const tier = tiers.find((t) => t.id === offer.tier_id);
    if (!tier) throw ApiError.notFound();
    const face = tier.face_cents;
    const fee = seatFeeCents(face);
    const total = face + fee + ORDER_FEE_CENTS;

    const account = await ensureKillBillAccount(deps.killbill, normalizeEmail(entry.email), entry.name);
    if (!account) throw ApiError.state(503, 'payments_unavailable');
    const orderId = newOrderNumber();
    await client.query(
      `INSERT INTO orders (id, performance_id, buyer_id, name, email, email_lower, status, face_cents, seat_fees_cents, order_fee_cents, total_cents, net_paid_cents, receipt, killbill_account_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending_payment', $7, $8, $9, $10, 0, NULL, $11)`,
      [orderId, offer.performance_id, entry.buyer_id, entry.name, entry.email, normalizeEmail(entry.email), face, fee, ORDER_FEE_CENTS, total, account],
    );
    const ticketId = newToken('tk');
    await client.query(
      `INSERT INTO tickets (id, order_id, performance_id, seat_id, tier_id, tier_name, face_cents, seat_fee_cents, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'payment_pending')`,
      [ticketId, orderId, offer.performance_id, offer.seat_id, tier.id, tier.name, face, fee],
    );
    const payment = await recordPurchase(client, deps.killbill, { orderId, accountId: account, totalCents: total });
    if (payment.outcome === 'unavailable') {
      await client.query(`DELETE FROM tickets WHERE id = $1`, [ticketId]);
      await client.query(`DELETE FROM orders WHERE id = $1`, [orderId]);
      throw ApiError.state(503, 'payments_unavailable');
    }
    if (payment.outcome === 'declined') {
      await client.query(`DELETE FROM tickets WHERE id = $1`, [ticketId]);
      await client.query(`DELETE FROM orders WHERE id = $1`, [orderId]);
      await client.query(`UPDATE offers SET status = 'declined' WHERE token = $1`, [token]);
      await client.query(`UPDATE waitlist_entries SET status = 'declined' WHERE id = $1`, [entry.id]);
      const salesOpen = performance.starts_at.getTime() > now.getTime();
      await freeSeat(client, {
        performanceId: offer.performance_id,
        seatId: offer.seat_id,
        salesOpen,
        offerSeconds: deps.offerSeconds,
        now,
        mailer: deps.mailer,
      });
      throw ApiError.state(402, 'payment_declined');
    }
    await client.query(`UPDATE offers SET status = 'accepted' WHERE token = $1`, [token]);
    await client.query(`UPDATE waitlist_entries SET status = 'accepted' WHERE id = $1`, [entry.id]);
    await client.query(`UPDATE seats SET state = 'sold', hold_token = NULL WHERE performance_id = $1 AND seat_id = $2`, [
      offer.performance_id,
      offer.seat_id,
    ]);
    await client.query(`UPDATE tickets SET status = 'issued' WHERE id = $1`, [ticketId]);
    await client.query(`UPDATE orders SET status = 'paid', net_paid_cents = total_cents, receipt = 'queued' WHERE id = $1`, [orderId]);
    const orderRowResult = await client.query<OrderRow>('SELECT * FROM orders WHERE id = $1', [orderId]);
    const tickets = await ticketRows(client, orderId);
    await queueReceiptEmail(client, deps.mailer, { order: orderRowResult.rows[0], tickets, performance });
    const built = await buildOrder(client, orderRowResult.rows[0]);
    sendJson(scope.res, 201, { order: built });
  });
}

async function postDeclineOffer(scope: RequestScope, deps: ApiDeps): Promise<void> {
  const token = scope.url.pathname.split('/')[3];
  const client = await deps.db.connect();
  try {
    await client.query('BEGIN');
    const now = new Date();
    const offerResult = await client.query<OfferRow>('SELECT * FROM offers WHERE token = $1 FOR UPDATE', [token]);
    const offer = offerResult.rows[0];
    if (!offer) throw ApiError.notFound();
    if (offer.status !== 'open') throw ApiError.state(409, 'offer_closed');
    if (offer.expires_at.getTime() <= now.getTime()) {
      await client.query(`UPDATE offers SET status = 'expired' WHERE token = $1`, [token]);
      await client.query(`UPDATE waitlist_entries SET status = 'expired' WHERE id = $1`, [offer.entry_id]);
      await client.query('COMMIT');
      throw ApiError.state(410, 'offer_expired');
    }
    const entryResult = await client.query<EntryRow>('SELECT * FROM waitlist_entries WHERE id = $1', [offer.entry_id]);
    const entry = entryResult.rows[0];
    if (!entry || entry.buyer_id !== buyerOf(scope)) throw ApiError.notFound();
    const performance = await performanceById(client, offer.performance_id);
    if (!performance) throw ApiError.notFound();
    const salesOpen = performance.starts_at.getTime() > now.getTime();
    await client.query(`UPDATE offers SET status = 'declined' WHERE token = $1`, [token]);
    await client.query(`UPDATE waitlist_entries SET status = 'declined' WHERE id = $1`, [offer.entry_id]);
    await client.query(`UPDATE seats SET state = 'held', hold_token = 'offer-decline' WHERE performance_id = $1 AND seat_id = $2 AND state = 'offered'`, [
      offer.performance_id,
      offer.seat_id,
    ]);
    await freeSeat(client, {
      performanceId: offer.performance_id,
      seatId: offer.seat_id,
      salesOpen,
      offerSeconds: deps.offerSeconds,
      now,
      mailer: deps.mailer,
    });
    await client.query('COMMIT');
    const built = await buildOffer(deps.db, offer, new Date());
    sendJson(scope.res, 200, { offer: built });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* transaction already closed */
    }
    throw error;
  } finally {
    client.release();
  }
}

async function postOwnerSession(scope: RequestScope, deps: ApiDeps): Promise<void> {
  const body = asObject(scope.bodyJson);
  const passcode = typeof body.passcode === 'string' ? body.passcode : '';
  const result = await deps.db.query<{ passcode_hash: string; salt: string }>('SELECT passcode_hash, salt FROM owner_settings LIMIT 1');
  const settings = result.rows[0];
  if (!settings) throw ApiError.state(503, 'owner_unavailable');
  const hashed = sha256(`${passcode}:${settings.salt}`);
  if (hashed !== settings.passcode_hash) throw ApiError.unauthorized();
  scope.state.set('setOwnerCookie', sha256(`owner:${settings.salt}`));
  scope.res.setHeader('Set-Cookie', ownerCookieHeader(sha256(`owner:${settings.salt}`)));
  scope.res.writeHead(204, { 'Content-Type': 'application/json; charset=utf-8' });
  scope.res.end();
}

async function deleteOwnerSession(scope: RequestScope): Promise<void> {
  scope.state.set('clearOwnerCookie', true);
  scope.res.setHeader('Set-Cookie', 'seatwise_owner=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  scope.res.writeHead(204, { 'Content-Type': 'application/json; charset=utf-8' });
  scope.res.end();
}

async function requireOwner(scope: RequestScope, deps: ApiDeps): Promise<void> {
  const cookie = scope.cookies['seatwise_owner'];
  const result = await deps.db.query<{ passcode_hash: string; salt: string }>('SELECT passcode_hash, salt FROM owner_settings LIMIT 1');
  const settings = result.rows[0];
  if (!settings || !cookie || cookie !== sha256(`owner:${settings.salt}`)) throw ApiError.unauthorized();
}

async function ownerPerformances(scope: RequestScope, deps: ApiDeps): Promise<void> {
  await requireOwner(scope, deps);
  const now = new Date();
  const rows = await performanceRows(deps.db);
  const performances = [];
  for (const row of rows) {
    performances.push(await buildPerformance(deps.db, row, now, true));
  }
  sendJson(scope.res, 200, { performances });
}

async function ownerPublish(scope: RequestScope, deps: ApiDeps): Promise<void> {
  await requireOwner(scope, deps);
  const body = asObject(scope.bodyJson);
  const fields = await validatePublish(body);
  if (Object.keys(fields).length > 0) throw ApiError.validation(fields);
  const title = String(body.title).trim();
  const startsLocal = String(body.startsLocal);
  const { resolveVenueWallClock } = await import('./venue-time');
  const resolved = resolveVenueWallClock(startsLocal, new Date());
  if (!resolved.ok) throw ApiError.validation({ startsLocal: publishMessageFor(resolved.reason) });
  const performanceId = slugify(title);
  const client = await deps.db.connect();
  try {
    await client.query('BEGIN');
    let finalId = performanceId;
    for (let attempt = 2; ; attempt += 1) {
      const clash = await client.query('SELECT id FROM performances WHERE id = $1', [finalId]);
      if ((clash.rowCount ?? 0) === 0) break;
      finalId = `${performanceId}-${attempt}`;
    }
    await client.query('INSERT INTO performances (id, title, starts_at) VALUES ($1, $2, $3)', [finalId, title, resolved.instant]);
    const tiers = body.tiers as Array<{ name: string; faceCents: number; rows?: string[]; seats?: string[] }>;
    const covered = new Set<string>();
    for (const tier of tiers) {
      const tierId = slugify(String(tier.name));
      await client.query('INSERT INTO tiers (performance_id, id, name, face_cents) VALUES ($1, $2, $3, $4)', [
        finalId,
        tierId,
        String(tier.name).trim(),
        Number(tier.faceCents),
      ]);
      const seatIds: string[] = [];
      for (const row of tier.rows ?? []) {
        for (let n = 1; n <= 30; n += 1) seatIds.push(`${row}-${n}`);
      }
      for (const seat of tier.seats ?? []) seatIds.push(seat);
      for (const seatId of seatIds) {
        if (covered.has(seatId)) throw ApiError.validation({ tiers: 'Each tier needs a name, a face value from $1.00 to $1,000.00 and at least one seat that no other tier uses.' });
        covered.add(seatId);
        await client.query('INSERT INTO seats (performance_id, seat_id, tier_id, state) VALUES ($1, $2, $3, $4)', [
          finalId,
          seatId,
          tierId,
          'on_sale',
        ]);
      }
    }
    const { allSeatIds } = await import('./hall');
    for (const seatId of allSeatIds()) {
      if (covered.has(seatId)) continue;
      await client.query('INSERT INTO seats (performance_id, seat_id, tier_id, state) VALUES ($1, $2, NULL, $3)', [
        finalId,
        seatId,
        'not_on_sale',
      ]);
    }
    await client.query('COMMIT');
    const performance = await performanceById(deps.db, finalId);
    if (performance) {
      sendJson(scope.res, 201, { performance: await buildPerformance(deps.db, performance, new Date(), false) });
    }
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* transaction already closed */
    }
    throw error;
  } finally {
    client.release();
  }
}

function publishMessageFor(reason: 'format' | 'nonexistent' | 'past'): string {
  if (reason === 'nonexistent') return 'That time does not occur in Chicago on that date.';
  if (reason === 'past') return 'The start must be in the future.';
  return 'Enter the start as YYYY-MM-DDTHH:MM.';
}

async function validatePublish(body: Record<string, unknown>): Promise<Record<string, string>> {
  const fields: Record<string, string> = {};
  const title = typeof body.title === 'string' ? body.title : '';
  if (title.trim().length < 1 || title.trim().length > 120) {
    fields.title = 'Enter a title of 1 to 120 characters.';
  }
  const startsLocal = typeof body.startsLocal === 'string' ? body.startsLocal : '';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(startsLocal)) {
    fields.startsLocal = 'Enter the start as YYYY-MM-DDTHH:MM.';
  } else {
    const { resolveVenueWallClock } = await import('./venue-time');
    const resolved = resolveVenueWallClock(startsLocal, new Date());
    if (!resolved.ok) fields.startsLocal = publishMessageFor(resolved.reason);
  }
  const tiers = body.tiers;
  if (!Array.isArray(tiers) || tiers.length < 1 || tiers.length > 6) {
    fields.tiers = 'Add between 1 and 6 tiers.';
    return fields;
  }
  const tierMessage = 'Each tier needs a name, a face value from $1.00 to $1,000.00 and at least one seat that no other tier uses.';
  const ids = new Set<string>();
  for (const tier of tiers) {
    if (typeof tier !== 'object' || tier === null) {
      fields.tiers = tierMessage;
      return fields;
    }
    const record = tier as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name : '';
    if (name.trim().length < 1 || name.trim().length > 40) {
      fields.tiers = tierMessage;
      return fields;
    }
    const id = slugify(name.trim());
    if (ids.has(id)) {
      fields.tiers = tierMessage;
      return fields;
    }
    ids.add(id);
    const face = Number(record.faceCents);
    if (!Number.isInteger(face) || face < 100 || face > 100000) {
      fields.tiers = tierMessage;
      return fields;
    }
    const rows = Array.isArray(record.rows) ? (record.rows as unknown[]).filter((r): r is string => typeof r === 'string') : [];
    const seats = Array.isArray(record.seats) ? (record.seats as unknown[]).filter((s): s is string => typeof s === 'string') : [];
    const { isRowId, isSeatId } = await import('./hall');
    if (rows.some((row) => !isRowId(row)) || seats.some((seat) => !isSeatId(seat))) {
      fields.tiers = tierMessage;
      return fields;
    }
    const seatCount = rows.length * 30 + seats.length;
    if (seatCount === 0) {
      fields.tiers = tierMessage;
      return fields;
    }
  }
  const covered = new Set<string>();
  for (const tier of tiers) {
    const record = tier as Record<string, unknown>;
    const rows = Array.isArray(record.rows) ? (record.rows as string[]) : [];
    const seats = Array.isArray(record.seats) ? (record.seats as string[]) : [];
    for (const row of rows) for (let n = 1; n <= 30; n += 1) covered.add(`${row}-${n}`);
    for (const seat of seats) covered.add(seat);
  }
  return fields;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function ownerOrders(scope: RequestScope, deps: ApiDeps): Promise<void> {
  await requireOwner(scope, deps);
  const result = await deps.db.query<OrderRow>('SELECT * FROM orders ORDER BY created_at DESC, id DESC');
  const orders: Order[] = [];
  for (const row of result.rows) {
    orders.push(await buildOrder(deps.db, row));
  }
  sendJson(scope.res, 200, { orders });
}

async function ownerOutbox(scope: RequestScope, deps: ApiDeps): Promise<void> {
  await requireOwner(scope, deps);
  const result = await deps.db.query<{
    id: number;
    to_address: string;
    subject: string;
    kind: string;
    status: string;
    attempts: number;
    created_at: Date;
    sent_at: Date | null;
  }>('SELECT id, to_address, subject, kind, status, attempts, created_at, sent_at FROM outbox ORDER BY id DESC');
  sendJson(scope.res, 200, {
    messages: result.rows.map((row) => ({
      id: row.id,
      to: row.to_address,
      subject: row.subject,
      kind: row.kind,
      status: row.status,
      attempts: row.attempts,
      createdAt: row.created_at.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      sentAt: row.sent_at ? row.sent_at.toISOString().replace(/\.\d{3}Z$/, 'Z') : null,
    })),
  });
}

async function getEvents(scope: RequestScope, deps: ApiDeps): Promise<void> {
  const res = scope.res;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });
  res.write(':ok\n\n');
  const timer = setInterval(async () => {
    try {
      const versions = await deps.db.query<{ channel: string; version: string }>('SELECT channel, version FROM streams');
      res.write(`data: ${JSON.stringify(versions.rows.map((row) => [row.channel, Number(row.version)]))}\n\n`);
    } catch {
      /* keep the stream open */
    }
  }, 1000);
  const close = () => {
    clearInterval(timer);
    res.end();
  };
  scope.req.on('close', close);
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw ApiError.validation({});
  }
  return value as Record<string, unknown>;
}

type KeyedOutcome = { setBody: (body: unknown, status: number) => void };

async function runKeyed(
  scope: RequestScope,
  deps: ApiDeps,
  keyed: { scope: 'buyer' | 'offer'; buyerId: string; subkey: string },
  work: (client: PoolClient, outcome: KeyedOutcome) => Promise<void>,
): Promise<void> {
  const key = scope.req.headers['idempotency-key'];
  if (typeof key !== 'string' || key.length < 1 || key.length > 100 || !/^[\x20-\x7E]+$/.test(key)) {
    throw ApiError.validation({ idempotencyKey: VALIDATION_MESSAGES.idempotencyKey });
  }
  const bodyText = scope.rawBody.toString('utf8');
  const path = scope.url.pathname;
  const client = await deps.db.connect();
  try {
    const stored = await client.query<{ status: number; response_body: string; body_sha256: string; method: string; path: string }>(
      'SELECT * FROM idempotency_records WHERE buyer_id = $1 AND key = $2',
      [keyedScope(keyed), key],
    );
    if (stored.rows[0]) {
      const row = stored.rows[0];
      if (row.body_sha256 !== sha256(bodyText) || row.path !== path) {
        throw ApiError.state(409, 'idempotency_conflict');
      }
      sendJson(scope.res, row.status, JSON.parse(row.response_body));
      return;
    }
    const running = await client.query('INSERT INTO idempotency_running (key, buyer_id) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING RETURNING key', [
      `${keyedScope(keyed)}:${key}`,
      keyed.buyerId,
    ]);
    if (running.rowCount === 0) {
      await waitForCompletion(deps, keyed, key, scope, path, bodyText);
      return;
    }
    type StoredResponse = { status: number; body: unknown };
    let setBodyCalled = false;
    let storedBody: StoredResponse | null = null;
    const outcome: KeyedOutcome = {
      setBody: (body: unknown, status: number) => {
        setBodyCalled = true;
        const snapshot: StoredResponse = { status, body };
        storedBody = snapshot;
        sendJson(scope.res, status, body);
      },
    };
    try {
      await client.query('BEGIN');
      await work(client, outcome);
      await client.query('COMMIT');
      const completed = storedBody as StoredResponse | null;
      if (completed !== null && (completed.status === 200 || completed.status === 201 || completed.status === 402)) {
        await deps.db.query(
          `INSERT INTO idempotency_records (buyer_id, key, method, path, body_sha256, status, response_body)
           VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (buyer_id, key) DO NOTHING`,
          [keyedScope(keyed), key, scope.method, path, sha256(bodyText), completed.status, JSON.stringify(completed.body)],
        );
      }
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      await client.query('DELETE FROM idempotency_running WHERE key = $1', [`${keyedScope(keyed)}:${key}`]);
    }
    if (!setBodyCalled) {
      throw new Error('keyed handler did not respond');
    }
  } finally {
    client.release();
  }
}

function keyedScope(keyed: { scope: 'buyer' | 'offer'; buyerId: string; subkey: string }): string {
  return keyed.scope === 'offer' ? `offer:${keyed.subkey}` : keyed.buyerId;
}

async function waitForCompletion(
  deps: ApiDeps,
  keyed: { scope: 'buyer' | 'offer'; buyerId: string; subkey: string },
  key: string,
  scope: RequestScope,
  path: string,
  bodyText: string,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const stored = await deps.db.query<{ status: number; response_body: string; body_sha256: string; path: string }>(
      'SELECT * FROM idempotency_records WHERE buyer_id = $1 AND key = $2',
      [keyedScope(keyed), key],
    );
    if (stored.rows[0]) {
      const row = stored.rows[0];
      if (row.body_sha256 !== sha256(bodyText) || row.path !== path) {
        throw ApiError.state(409, 'idempotency_conflict');
      }
      sendJson(scope.res, row.status, JSON.parse(row.response_body));
      return;
    }
    const stillRunning = await deps.db.query('SELECT key FROM idempotency_running WHERE key = $1', [
      `${keyedScope(keyed)}:${key}`,
    ]);
    if (stillRunning.rowCount === 0) break;
  }
  throw ApiError.state(409, 'idempotency_conflict');
}

export { seatFeeCents, formatCents, ORDER_FEE_CENTS };
