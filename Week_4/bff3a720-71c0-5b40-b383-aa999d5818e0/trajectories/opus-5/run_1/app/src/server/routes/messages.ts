import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { now } from '../clock.js';
import { db } from '../db.js';
import { errors } from '../errors.js';
import { isoZoned } from '../domain/time.js';
import { checkLimit, recordAttempt } from '../limits.js';
import { keys } from '../valkey.js';
import { presenceOf, publishToMembers, publishToThread } from '../live.js';
import { loadBooking, loadRide, type BookingRecord, type RideRecord } from '../model.js';
import type { Ctx, Reply, Router } from '../http.js';

/** The thread of a booking is shared by its passenger and the ride's driver. */
async function loadThread(
  ctx: Ctx,
): Promise<{ booking: BookingRecord; ride: RideRecord; otherId: string; memberId: string }> {
  const member = ctx.requireMember();
  const booking = await loadBooking(db, ctx.param('id'));
  if (!booking) throw errors.notFound();
  const ride = await loadRide(db, booking.ride_id);
  if (!ride) throw errors.notFound();
  if (booking.passenger_id !== member.id && ride.driver_id !== member.id) {
    throw errors.notFound();
  }
  return {
    booking,
    ride,
    memberId: member.id,
    otherId: booking.passenger_id === member.id ? ride.driver_id : booking.passenger_id,
  };
}

async function list(ctx: Ctx): Promise<Reply> {
  const { booking, otherId } = await loadThread(ctx);
  const { rows } = await db.query<{
    id: string;
    author_id: string;
    body: string;
    sent_at: Date;
  }>(
    'select id, author_id, body, sent_at from messages where booking_id = $1 order by seq',
    [booking.id],
  );
  return {
    status: 200,
    body: {
      messages: rows.map((row) => ({
        id: row.id,
        author_id: row.author_id,
        body: row.body,
        sent_at: isoZoned(row.sent_at),
      })),
      presence: await presenceOf(booking.id, otherId),
    },
  };
}

async function send(ctx: Ctx): Promise<Reply> {
  const { booking, memberId, otherId } = await loadThread(ctx);
  const at = now();
  const decision = await checkLimit(
    keys.rateMessages(memberId),
    config.limits.messageRatePerMinute,
    60_000,
    at,
  );
  if (!decision.allowed) throw errors.rateLimitedMessages(decision.retryAfterSeconds);

  const body = ctx.json();
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (text.length < 1 || text.length > 1000) {
    throw errors.validationFailed({ body: 'Write between 1 and 1,000 characters.' });
  }
  await recordAttempt(keys.rateMessages(memberId), at);

  const id = randomUUID();
  await db.query(
    'insert into messages (id, booking_id, author_id, body, sent_at) values ($1, $2, $3, $4, $5)',
    [id, booking.id, memberId, text, at],
  );
  const message = { id, author_id: memberId, body: text, sent_at: isoZoned(at) };
  publishToThread(booking.id, [memberId, otherId], 'message', {
    booking_id: booking.id,
    message,
  });
  publishToMembers([memberId, otherId], 'message', { booking_id: booking.id, message });
  return { status: 201, body: message };
}

export function registerMessageRoutes(router: Router): void {
  router.add({
    method: 'GET',
    pattern: '/api/bookings/:id/messages',
    kind: 'plain',
    auth: 'member',
    handler: list,
  });
  router.add({
    method: 'POST',
    pattern: '/api/bookings/:id/messages',
    kind: 'json',
    auth: 'member',
    handler: send,
  });
}
