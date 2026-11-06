import type { Reply, RequestContext } from '../http/router.js';
import { json } from '../http/router.js';
import { ApiError, fieldError, notFound, validationFailed } from '../http/errors.js';
import { requireStaff } from './guards.js';
import type { OrderRecord } from '../db/orders.js';
import {
  findOrderByRef,
  findOrdersByEmail,
  recordRefund,
  refundsForOrder,
} from '../db/orders.js';
import { retireCopyForOrder } from '../db/editions.js';
import { seatRefundCents } from '../domain/money.js';
import { withIdempotency } from '../db/idempotency.js';
import { refundPayment } from '../services/killbill.js';
import { sendRefundEmail } from '../services/emails.js';
import { currentHealth } from '../services/health.js';
import { queueCounts } from '../db/uploads.js';

function orderPayload(order: OrderRecord): Record<string, unknown> {
  return {
    order: order.orderRef,
    email: order.email,
    model: order.modelSlug,
    licence: order.licence,
    seats: order.seats,
    refunded_seats: order.refundedSeats,
    amount_cents: order.amountCents,
    refunded_cents: order.refundedCents,
    refundable_cents: order.refundableCents,
    status: order.status,
    edition_number: order.editionNumber,
    created_at: order.createdAt.toISOString(),
    locale: order.locale,
  };
}

/** Exactly one of `email` or `order`; both or neither is a `lookup` failure. */
export async function ordersHandler(ctx: RequestContext): Promise<Reply> {
  requireStaff(ctx);
  const email = ctx.query.get('email');
  const orderRef = ctx.query.get('order');
  if ((email === null) === (orderRef === null)) {
    throw validationFailed([fieldError('lookup', 'lookup')]);
  }
  const orders =
    email !== null
      ? await findOrdersByEmail(email)
      : await findOrderByRef(orderRef ?? '').then((o) => (o === null ? [] : [o]));
  return json(200, { orders: orders.map(orderPayload) });
}

interface RefundRequest {
  readonly kind: 'full' | 'seats';
  readonly seats: number | null;
}

function readRefundBody(raw: Record<string, unknown>, order: OrderRecord): RefundRequest {
  if (raw.kind === 'full') return { kind: 'full', seats: null };
  if (raw.kind !== 'seats') throw validationFailed([fieldError('kind', 'choose_one')]);
  const seats = raw.seats;
  const held = order.seats - order.refundedSeats;
  if (
    typeof seats !== 'number' ||
    !Number.isSafeInteger(seats) ||
    seats < 1 ||
    seats >= held ||
    order.licence !== 'studio'
  ) {
    throw validationFailed([fieldError('seats', 'seats')]);
  }
  return { kind: 'seats', seats };
}

async function runRefund(ctx: RequestContext, order: OrderRecord): Promise<Reply> {
  if (order.refundableCents <= 0) throw new ApiError('nothing_to_refund');
  const request = readRefundBody(ctx.body, order);
  const amount =
    request.kind === 'full'
      ? order.refundableCents
      : seatRefundCents(order.amountCents, request.seats ?? 0);

  if (order.killbillPaymentId === null) throw new ApiError('nothing_to_refund');
  await refundPayment(order.killbillPaymentId, amount);

  await recordRefund(order.id, request.kind, request.seats, amount);
  const after = await findOrderByRef(order.orderRef);
  if (after === null) throw notFound();
  if (after.status === 'refunded' && after.editionNumber !== null) {
    await retireCopyForOrder(after.id);
  }

  const sequence = (await refundsForOrder(order.id)).length;
  await sendRefundEmail(order.orderRef, order.email, order.locale, amount, sequence);

  return json(201, {
    order: after.orderRef,
    refund_cents: amount,
    refunded_cents: after.refundedCents,
    refundable_cents: after.refundableCents,
    status: after.status,
  });
}

export async function refundHandler(ctx: RequestContext): Promise<Reply> {
  requireStaff(ctx);
  const order = await findOrderByRef(ctx.params.order ?? '');
  if (order === null) throw notFound();
  const key = ctx.idempotencyKey;
  if (key === null) throw new ApiError('idempotency_key_required');
  return withIdempotency(`refund:${order.orderRef}`, key, ctx.body, async () =>
    runRefund(ctx, order),
  );
}

/** No credential, provider URL or internal identifier appears here. */
export async function healthHandler(ctx: RequestContext): Promise<Reply> {
  requireStaff(ctx);
  const health = currentHealth();
  return json(200, {
    services: health.services,
    checked_at: health.checkedAt,
    queue: await queueCounts(),
  });
}

