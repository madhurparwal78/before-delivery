import { db } from '../db.js';
import { errors } from '../errors.js';
import { flushRows } from '../outbox.js';
import { loadBooking, loadRide } from '../model.js';
import { ratingView, submitRating } from '../actions/ratings.js';
import type { Ctx, Reply, Router } from '../http.js';

async function assertParty(ctx: Ctx): Promise<void> {
  const member = ctx.requireMember();
  const booking = await loadBooking(db, ctx.param('id'));
  if (!booking) throw errors.notFound();
  const ride = await loadRide(db, booking.ride_id);
  if (!ride) throw errors.notFound();
  if (booking.passenger_id !== member.id && ride.driver_id !== member.id) {
    throw errors.notFound();
  }
}

async function get(ctx: Ctx): Promise<Reply> {
  await assertParty(ctx);
  return { status: 200, body: await ratingView(ctx.param('id'), ctx.requireMember().id) };
}

async function post(ctx: Ctx): Promise<Reply> {
  await assertParty(ctx);
  const body = ctx.json();
  await submitRating(ctx.param('id'), ctx.requireMember().id, body.stars, body.comment);
  const { rows } = await db.query<{ id: string }>(
    `select id from outbox where booking_id = $1 and kind = 'ratings_revealed' and status = 'queued'`,
    [ctx.param('id')],
  );
  await flushRows(rows.map((row) => row.id));
  return { status: 201, body: await ratingView(ctx.param('id'), ctx.requireMember().id) };
}

export function registerRatingRoutes(router: Router): void {
  router.add({
    method: 'GET',
    pattern: '/api/bookings/:id/rating',
    kind: 'plain',
    auth: 'member',
    handler: get,
  });
  router.add({
    method: 'POST',
    pattern: '/api/bookings/:id/rating',
    kind: 'json',
    auth: 'member',
    handler: post,
  });
}
