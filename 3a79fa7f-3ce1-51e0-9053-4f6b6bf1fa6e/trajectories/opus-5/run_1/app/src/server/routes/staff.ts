import { isoSeconds, now } from '../clock.js';
import { one, query, withTransaction } from '../db.js';
import { fail, failValidation } from '../errors.js';
import { reply, type Router } from '../http.js';
import { requireStaff } from '../auth.js';
import { formatCents } from '../money.js';
import { isBoundedText, isJsonInteger } from '../domain/validate.js';
import { decodeCursor, parseLimit } from '../domain/cursor.js';
import { DEMO_CREDIT_CENTS } from '../domain/checkout.js';
import { maskEmail, slotLabel } from '../domain/locations.js';
import { orderShape, type OrderRow } from '../domain/orders.js';
import { queueNotice } from '../services/notices.js';
import { listOrders } from './orders.js';
import { DEMO_CREDIT_LIFETIME_SECONDS } from './demo.js';
import { TRADE_IN_SELECT, effectiveStatus, quoteExpiresAt, tradeInShape, type TradeInRow } from './tradeins.js';

const TRADE_IN_STATUSES = ['submitted', 'quoted', 'accepted', 'rejected', 'expired', 'applied'];

async function shipOrDeliver(
  number: string,
  from: string,
  to: string,
  byEmail: string,
): Promise<Record<string, unknown>> {
  const at = now();
  return withTransaction(async (client) => {
    const order = await one<OrderRow>(client, 'SELECT * FROM orders WHERE number = $1 FOR UPDATE', [number]);
    if (!order) fail('not_found');
    if (order.status !== from) fail('illegal_transition', { message: 'This order cannot be changed now.' });
    await client.query('UPDATE orders SET status = $2 WHERE number = $1', [number, to]);
    await client.query('INSERT INTO order_events (order_number, status, at, by_email) VALUES ($1,$2,$3,$4)', [
      number,
      to,
      at,
      byEmail,
    ]);
    const updated = await one<OrderRow>(client, 'SELECT * FROM orders WHERE number = $1', [number]);
    if (!updated) throw new Error('Order vanished during a status move');
    return orderShape(client, updated);
  });
}

export function registerStaffRoutes(router: Router): void {
  router.add('GET', '/api/staff/trade-ins', ['admin', 'support'], async (ctx) => {
    requireStaff(ctx, ['admin', 'support']);
    const at = now();
    const wanted = ctx.url.searchParams.get('status');
    if (wanted && !TRADE_IN_STATUSES.includes(wanted)) failValidation({ status: 'Choose a trade-in status.' });
    const found = await query<TradeInRow>(`${TRADE_IN_SELECT} ORDER BY id`, []);
    const filtered = wanted ? found.filter((row) => effectiveStatus(row, at) === wanted) : found;
    return { trade_ins: filtered.map((row) => tradeInShape(row, at)) };
  });

  router.add('POST', '/api/staff/trade-ins/:id/quote', ['admin', 'support'], async (ctx) => {
    requireStaff(ctx, ['admin', 'support']);
    const at = now();
    const id = ctx.params.id ?? '';
    if (!/^[0-9]+$/.test(id)) fail('not_found');
    const amount = ctx.body.amount_cents;
    if (!isJsonInteger(amount) || amount < 100 || amount > 500000) {
      failValidation({ amount_cents: 'Enter an amount from $1.00 to $5,000.00.' });
    }

    return withTransaction(async (client) => {
      const row = await one<TradeInRow & { email: string }>(
        client,
        `SELECT t.id, t.user_id, t.status, t.brand, t.model_year, t.condition, t.serial, t.note, t.quote_cents,
                t.quote_expires_at, t.reject_reason, t.order_number, u.email
         FROM trade_ins t JOIN users u ON u.id = t.user_id WHERE t.id = $1 FOR UPDATE OF t`,
        [id],
      );
      if (!row) fail('not_found');
      if (row.status !== 'submitted') fail('illegal_transition', { message: 'This trade-in cannot be changed now.' });

      const expiresAt = quoteExpiresAt(at);
      await client.query(
        `UPDATE trade_ins SET status = 'quoted', quote_cents = $2, quote_expires_at = $3 WHERE id = $1`,
        [id, amount, expiresAt],
      );
      await queueNotice(
        client,
        {
          to: row.email,
          template: 'trade_in_quoted',
          reference: String(row.id),
          subject: `Trade-in quoted: ${formatCents(amount)}`,
          body: `We have quoted your trade-in.\nReference ${row.id}\nCredit ${formatCents(amount)}\nValid until ${isoSeconds(expiresAt)}`,
        },
        at,
      );
      return tradeInShape(
        { ...row, status: 'quoted', quote_cents: amount, quote_expires_at: expiresAt },
        at,
      );
    });
  });

  router.add('POST', '/api/staff/trade-ins/:id/reject', ['admin', 'support'], async (ctx) => {
    requireStaff(ctx, ['admin', 'support']);
    const at = now();
    const id = ctx.params.id ?? '';
    if (!/^[0-9]+$/.test(id)) fail('not_found');
    if (!isBoundedText(ctx.body.reason, 3, 200)) failValidation({ reason: 'Enter a reason of 3 to 200 characters.' });

    return withTransaction(async (client) => {
      const row = await one<TradeInRow>(client, `${TRADE_IN_SELECT} WHERE id = $1 FOR UPDATE`, [id]);
      if (!row) fail('not_found');
      if (row.status !== 'submitted') fail('illegal_transition', { message: 'This trade-in cannot be changed now.' });
      await client.query(`UPDATE trade_ins SET status = 'rejected', reject_reason = $2 WHERE id = $1`, [
        id,
        ctx.body.reason,
      ]);
      return tradeInShape({ ...row, status: 'rejected', reject_reason: ctx.body.reason as string }, at);
    });
  });

  router.add('POST', '/api/staff/locations/:id/slots', ['admin', 'dealer'], async (ctx) => {
    requireStaff(ctx, ['admin', 'dealer']);
    const at = now();
    const id = ctx.params.id ?? '';
    if (!/^[0-9]+$/.test(id)) fail('not_found');
    const location = (
      await query<{ id: number; timezone: string }>('SELECT id, timezone FROM locations WHERE id = $1', [id])
    )[0];
    if (!location) fail('not_found');

    const fields: Record<string, string> = {};
    const startsAt = parseInstant(ctx.body.starts_at);
    const endsAt = parseInstant(ctx.body.ends_at);
    if (!startsAt || startsAt.getTime() <= at.getTime()) fields.starts_at = 'Choose a start in the future.';
    if (!endsAt || !startsAt || endsAt.getTime() <= startsAt.getTime()) fields.ends_at = 'Choose an end after the start.';
    const capacity = ctx.body.capacity;
    if (!isJsonInteger(capacity) || capacity < 1 || capacity > 20) fields.capacity = 'Choose a capacity from 1 to 20.';
    if (Object.keys(fields).length > 0) failValidation(fields);

    const created = (
      await query<{ id: string }>(
        `INSERT INTO demo_slots (id, location_id, starts_at, ends_at, capacity)
         VALUES (nextval('demo_slot_ids'), $1, $2, $3, $4) RETURNING id`,
        [location.id, startsAt, endsAt, capacity],
      )
    )[0];
    if (!created) throw new Error('Slot was not stored');
    const start = startsAt as Date;
    const end = endsAt as Date;
    return reply(201, {
      id: Number(created.id),
      location_id: location.id,
      starts_at: isoSeconds(start),
      ends_at: isoSeconds(end),
      capacity,
      seats_left: capacity,
      timezone: location.timezone,
      label: slotLabel(start, end, location.timezone),
    });
  });

  router.add('GET', '/api/staff/locations/:id/bookings', ['admin', 'dealer'], async (ctx) => {
    const session = requireStaff(ctx, ['admin', 'dealer']);
    const id = ctx.params.id ?? '';
    if (!/^[0-9]+$/.test(id)) fail('not_found');
    const location = (await query<{ id: number }>('SELECT id FROM locations WHERE id = $1', [id]))[0];
    if (!location) fail('not_found');
    const found = await query<{ id: string; slot_id: string; status: string; email: string }>(
      `SELECT b.id, b.slot_id, b.status, u.email FROM demo_bookings b
       JOIN demo_slots s ON s.id = b.slot_id JOIN users u ON u.id = b.user_id
       WHERE s.location_id = $1 ORDER BY s.starts_at, b.id`,
      [id],
    );
    return {
      bookings: found.map((row) => ({
        id: Number(row.id),
        slot_id: Number(row.slot_id),
        status: row.status,
        customer_email: session.role === 'dealer' ? maskEmail(row.email) : row.email,
      })),
    };
  });

  router.add('POST', '/api/staff/demo-bookings/:id/attended', ['admin', 'dealer'], async (ctx) => {
    const session = requireStaff(ctx, ['admin', 'dealer']);
    const at = now();
    const id = ctx.params.id ?? '';
    if (!/^[0-9]+$/.test(id)) fail('not_found');

    return withTransaction(async (client) => {
      const booking = await one<{ id: string; slot_id: string; status: string; user_id: string; starts_at: Date; email: string }>(
        client,
        `SELECT b.id, b.slot_id, b.status, b.user_id, s.starts_at, u.email FROM demo_bookings b
         JOIN demo_slots s ON s.id = b.slot_id JOIN users u ON u.id = b.user_id WHERE b.id = $1 FOR UPDATE OF b`,
        [id],
      );
      if (!booking) fail('not_found');
      if (booking.status !== 'booked') fail('illegal_transition', { message: 'This booking cannot be changed now.' });
      if (at.getTime() < booking.starts_at.getTime()) fail('not_started');

      await client.query(`UPDATE demo_bookings SET status = 'attended', attended_at = $2 WHERE id = $1`, [id, at]);
      await client.query(
        `INSERT INTO demo_credits (user_id, booking_id, amount_cents, expires_at)
         VALUES ($1,$2,$3,$4) ON CONFLICT (user_id) DO NOTHING`,
        [booking.user_id, id, DEMO_CREDIT_CENTS, new Date(at.getTime() + DEMO_CREDIT_LIFETIME_SECONDS * 1000)],
      );
      return {
        id: Number(booking.id),
        slot_id: Number(booking.slot_id),
        status: 'attended',
        customer_email: session.role === 'dealer' ? maskEmail(booking.email) : booking.email,
      };
    });
  });

  router.add('GET', '/api/staff/orders', ['admin'], async (ctx) => {
    requireStaff(ctx, ['admin']);
    const limit = parseLimit(ctx.url.searchParams.get('limit'));
    const cursor = ctx.url.searchParams.get('cursor');
    return listOrders(null, limit, cursor ? decodeCursor(cursor) : null);
  });

  router.add('POST', '/api/staff/orders/:number/ship', ['admin'], async (ctx) => {
    const session = requireStaff(ctx, ['admin']);
    return shipOrDeliver(ctx.params.number ?? '', 'placed', 'shipped', session.email);
  });

  router.add('POST', '/api/staff/orders/:number/deliver', ['admin'], async (ctx) => {
    const session = requireStaff(ctx, ['admin']);
    return shipOrDeliver(ctx.params.number ?? '', 'shipped', 'delivered', session.email);
  });

  router.add('GET', '/api/staff/outbox', ['admin', 'support'], async (ctx) => {
    requireStaff(ctx, ['admin', 'support']);
    const found = await query<{
      id: string;
      to_email: string;
      template: string;
      reference: string | null;
      subject: string;
      status: string;
      attempts: number;
      created_at: Date;
      sent_at: Date | null;
    }>(
      `SELECT id, to_email, template, reference, subject, status, attempts, created_at, sent_at
       FROM notices ORDER BY created_at DESC, id DESC`,
      [],
    );
    return {
      notices: found.map((row) => ({
        id: Number(row.id),
        to: row.to_email,
        template: row.template,
        reference: row.reference,
        subject: row.subject,
        status: row.status,
        attempts: row.attempts,
        created_at: isoSeconds(row.created_at),
        sent_at: row.sent_at ? isoSeconds(row.sent_at) : null,
      })),
    };
  });
}

function parseInstant(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
