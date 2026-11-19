import { FIELD_MESSAGES } from '../../../shared/copy';
import { rows, withTransaction } from '../../db';
import { holdSeats, MAX_SEATS_PER_PERFORMANCE, releaseHeldSeat } from '../../domain/cart';
import { loadPerformances } from '../../domain/performances';
import { checkout } from '../../domain/purchase';
import { releaseExpiredHolds } from '../../domain/seats';
import { joinWaitlist } from '../../domain/waitlist';
import type { RequestContext } from '../context';
import { onceByKey } from '../idempotency';
import { type ApiResponse, error, json, validationError } from '../respond';
import { buyerFieldErrors, field, stringArray, stringField } from '../validate';

export async function createHold(context: RequestContext): Promise<ApiResponse> {
  const performanceId = context.params.performanceId ?? '';
  await withTransaction((db) => releaseExpiredHolds(db, performanceId));
  return withTransaction(async (db) => {
    const performances = await loadPerformances(db, performanceId);
    if (performances.length === 0) return error(404, 'not_found');
    const requested = stringArray(field(context.body, 'seatIds'));
    const distinct = requested === undefined ? [] : [...new Set(requested)];
    const shapeValid =
      requested !== undefined &&
      distinct.length === requested.length &&
      distinct.length >= 1 &&
      distinct.length <= MAX_SEATS_PER_PERFORMANCE;
    if (!shapeValid) return validationError({ seatIds: FIELD_MESSAGES.seatIdsChoice });
    const tiered = await rows<{ seat_id: string }>(
      db,
      `select seat_id from seats
       where performance_id = $1 and seat_id = any($2::text[]) and tier_id is not null`,
      [performanceId, distinct],
    );
    if (tiered.length !== distinct.length) return validationError({ seatIds: FIELD_MESSAGES.seatIdsChoice });

    const outcome = await holdSeats(db, performanceId, context.buyerId, distinct);
    switch (outcome.kind) {
      case 'held':
        return json(200, { cart: outcome.cart, held: outcome.held, taken: outcome.taken });
      case 'sales_closed':
        return error(409, 'sales_closed');
      case 'seats_taken':
        return error(409, 'seats_taken', { taken: outcome.taken, cart: outcome.cart });
      case 'over_limit':
        return validationError({ seatIds: FIELD_MESSAGES.seatIdsLimit });
    }
  });
}

export async function deleteHold(context: RequestContext): Promise<ApiResponse> {
  const performanceId = context.params.performanceId ?? '';
  const seatId = context.params.seatId ?? '';
  return withTransaction(async (db) => {
    const cart = await releaseHeldSeat(db, performanceId, context.buyerId, seatId);
    return cart === null ? error(404, 'not_found') : json(200, { cart });
  });
}

export async function createCheckout(context: RequestContext): Promise<ApiResponse> {
  const performanceId = context.params.performanceId ?? '';
  const performances = await withTransaction((db) => loadPerformances(db, performanceId));
  if (performances.length === 0) return error(404, 'not_found');
  return onceByKey(context, context.buyerId, async () => {
    const name = stringField(context.body, 'name');
    const email = stringField(context.body, 'email');
    const fieldErrors = buyerFieldErrors(name, email);
    const result = await checkout({
      performanceId,
      buyerId: context.buyerId,
      name: name.trim(),
      email: email.trim(),
      fieldErrors,
    });
    switch (result.kind) {
      case 'paid':
        return json(201, { order: result.order });
      case 'sales_closed':
        return error(409, 'sales_closed');
      case 'cart_empty':
        return error(409, 'cart_empty');
      case 'invalid':
        return validationError(fieldErrors);
      case 'declined':
        return error(402, 'payment_declined');
      default:
        return error(503, 'payments_unavailable');
    }
  });
}

export async function createWaitlistEntry(context: RequestContext): Promise<ApiResponse> {
  const performanceId = context.params.performanceId ?? '';
  const tierId = context.params.tierId ?? '';
  const performances = await withTransaction((db) => loadPerformances(db, performanceId));
  const performance = performances[0];
  if (!performance || !performance.tiers.some((tier) => tier.id === tierId)) return error(404, 'not_found');
  const name = stringField(context.body, 'name');
  const email = stringField(context.body, 'email');
  const fieldErrors = buyerFieldErrors(name, email);
  const result = await joinWaitlist({
    performanceId,
    tierId,
    buyerId: context.buyerId,
    name,
    email,
    fieldErrors,
  });
  switch (result.kind) {
    case 'joined':
      return json(201, { entry: result.entry });
    case 'sales_closed':
      return error(409, 'sales_closed');
    case 'tier_not_sold_out':
      return error(409, 'tier_not_sold_out');
    case 'already_waiting':
      return error(409, 'already_waiting');
    case 'invalid':
      return validationError(fieldErrors);
  }
}
