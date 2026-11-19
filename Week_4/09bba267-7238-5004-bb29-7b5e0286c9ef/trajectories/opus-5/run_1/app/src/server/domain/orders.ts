import type { Order, OrderStatus, OwnerOrder, Ticket, TicketStatus } from '../../shared/api';
import { seatLabel } from '../../shared/hall';
import { ORDER_FEE_CENTS } from '../../shared/money';
import { formatVenueStart, toIsoSeconds } from '../../shared/venueTime';
import { type Db, first, rows } from '../db';
import { enqueueMessage } from '../services/outbox';
import { receiptMessage } from '../services/messages';
import { newOrderId, newUuid } from './ids';
import { markSeatSold } from './seats';

export interface NewTicketLine {
  readonly seatId: string;
  readonly tierId: string;
  readonly tierName: string;
  readonly faceCents: number;
  readonly seatFeeCents: number;
}

export interface PendingOrder {
  readonly id: string;
  readonly totalCents: number;
}

export async function createPendingOrder(
  db: Db,
  input: {
    readonly performanceId: string;
    readonly buyerId: string;
    readonly name: string;
    readonly email: string;
    readonly lines: readonly NewTicketLine[];
  },
): Promise<PendingOrder> {
  const orderId = newOrderId();
  await db.query(
    `insert into orders (id, performance_id, buyer_id, name, email, status, order_fee_cents)
     values ($1, $2, $3, $4, $5, 'pending_payment', $6)`,
    [orderId, input.performanceId, input.buyerId, input.name, input.email, ORDER_FEE_CENTS],
  );
  for (const line of input.lines) {
    await db.query(
      `insert into tickets (id, order_id, performance_id, seat_id, tier_id, tier_name, face_cents, seat_fee_cents, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'payment_pending')`,
      [
        newUuid(),
        orderId,
        input.performanceId,
        line.seatId,
        line.tierId,
        line.tierName,
        line.faceCents,
        line.seatFeeCents,
      ],
    );
  }
  const total = input.lines.reduce((sum, line) => sum + line.faceCents + line.seatFeeCents, 0) + ORDER_FEE_CENTS;
  return { id: orderId, totalCents: total };
}

export async function recordPaymentTransaction(
  db: Db,
  input: {
    readonly orderId: string;
    readonly kind: 'purchase' | 'refund';
    readonly paymentExternalKey: string;
    readonly killbillPaymentId: string;
    readonly amountCents: number;
  },
): Promise<void> {
  await db.query(
    `insert into payment_transactions (order_id, kind, payment_external_key, killbill_payment_id, amount_cents)
     values ($1, $2, $3, $4, $5)`,
    [input.orderId, input.kind, input.paymentExternalKey, input.killbillPaymentId, input.amountCents],
  );
}

export async function setKillbillAccount(db: Db, orderId: string, accountId: string | null): Promise<void> {
  if (accountId === null) return;
  await db.query(`update orders set killbill_account_id = $2 where id = $1 and killbill_account_id is null`, [
    orderId,
    accountId,
  ]);
}

/** Issues an order's tickets, sells its seats and queues its receipt in one transaction. */
export async function issueOrder(db: Db, orderId: string): Promise<void> {
  const order = await first<{
    performance_id: string;
    email: string;
    name: string;
    title: string;
    starts_at: Date;
    order_fee_cents: number;
  }>(
    db,
    `select o.performance_id, o.email, o.name, p.title, p.starts_at, o.order_fee_cents
     from orders o join performances p on p.id = o.performance_id where o.id = $1`,
    [orderId],
  );
  if (!order) return;
  const tickets = await rows<{ seat_id: string; tier_name: string; face_cents: number; seat_fee_cents: number }>(
    db,
    `select seat_id, tier_name, face_cents, seat_fee_cents from tickets where order_id = $1 order by created_at, id`,
    [orderId],
  );
  for (const ticket of tickets) {
    await markSeatSold(db, order.performance_id, ticket.seat_id);
  }
  await db.query(`update tickets set status = 'issued' where order_id = $1`, [orderId]);
  await db.query(`update orders set status = 'paid', receipt = 'queued' where id = $1`, [orderId]);
  await enqueueMessage(
    db,
    receiptMessage({
      orderId,
      email: order.email,
      performanceTitle: order.title,
      startsAt: order.starts_at,
      tickets: tickets.map((ticket) => ({
        label: seatLabel(ticket.seat_id),
        tierName: ticket.tier_name,
        faceCents: ticket.face_cents,
        seatFeeCents: ticket.seat_fee_cents,
      })),
      orderFeeCents: order.order_fee_cents,
      totalCents:
        tickets.reduce((sum, ticket) => sum + ticket.face_cents + ticket.seat_fee_cents, 0) + order.order_fee_cents,
    }),
  );
}

export async function cancelOrder(db: Db, orderId: string): Promise<void> {
  await db.query(`update orders set status = 'cancelled' where id = $1`, [orderId]);
}

export interface RefundablePayment {
  readonly killbillPaymentId: string;
  readonly paymentExternalKey: string;
  readonly refundableCents: number;
}

/** The order's payments, newest first, with what each can still give back. */
export async function refundablePayments(db: Db, orderId: string): Promise<RefundablePayment[]> {
  const payments = await rows<{
    killbill_payment_id: string;
    payment_external_key: string;
    purchased: string;
    refunded: string;
    newest: string;
  }>(
    db,
    `select killbill_payment_id, min(payment_external_key) as payment_external_key,
            coalesce(sum(amount_cents) filter (where kind = 'purchase'), 0) as purchased,
            coalesce(sum(amount_cents) filter (where kind = 'refund'), 0) as refunded,
            max(id) as newest
     from payment_transactions
     where order_id = $1
     group by killbill_payment_id
     order by max(id) desc`,
    [orderId],
  );
  return payments.map((payment) => ({
    killbillPaymentId: payment.killbill_payment_id,
    paymentExternalKey: payment.payment_external_key,
    refundableCents: Number(payment.purchased) - Number(payment.refunded),
  }));
}

export async function nextExchangeChargeNumber(db: Db, orderId: string): Promise<number> {
  const row = await first<{ exchange_charges: number }>(
    db,
    `update orders set exchange_charges = exchange_charges + 1 where id = $1 returning exchange_charges`,
    [orderId],
  );
  return row?.exchange_charges ?? 1;
}

export async function refreshOrderStatus(db: Db, orderId: string): Promise<void> {
  await db.query(
    `update orders o set status = case
       when exists (select 1 from tickets t where t.order_id = o.id and t.status <> 'refunded')
         and exists (select 1 from tickets t where t.order_id = o.id and t.status = 'refunded')
         then 'partially_refunded'
       when not exists (select 1 from tickets t where t.order_id = o.id and t.status <> 'refunded')
         then 'refunded'
       else 'paid' end
     where o.id = $1 and o.status in ('paid', 'partially_refunded', 'refunded')`,
    [orderId],
  );
}

interface OrderRow {
  id: string;
  performance_id: string;
  title: string;
  starts_at: Date;
  name: string;
  email: string;
  status: OrderStatus;
  order_fee_cents: number;
  receipt: 'queued' | 'sent' | null;
  created_at: Date;
  killbill_account_id: string | null;
}

interface TicketRow {
  id: string;
  order_id: string;
  seat_id: string;
  tier_name: string;
  face_cents: number;
  seat_fee_cents: number;
  status: TicketStatus;
}

export interface OrderQuery {
  readonly buyerId?: string;
  readonly orderId?: string;
  readonly includeCancelled: boolean;
}

export async function loadOrders(db: Db, filter: OrderQuery): Promise<OwnerOrder[]> {
  const orderRows = await rows<OrderRow>(
    db,
    `select o.id, o.performance_id, p.title, p.starts_at, o.name, o.email, o.status, o.order_fee_cents,
            o.receipt, o.created_at, o.killbill_account_id
     from orders o join performances p on p.id = o.performance_id
     where ($1::text is null or o.buyer_id = $1)
       and ($2::text is null or o.id = $2)
       and ($3::boolean or o.status <> 'cancelled')
     order by o.created_at desc, o.id desc`,
    [filter.buyerId ?? null, filter.orderId ?? null, filter.includeCancelled],
  );
  if (orderRows.length === 0) return [];
  const orderIds = orderRows.map((order) => order.id);
  const ticketRows = await rows<TicketRow>(
    db,
    `select id, order_id, seat_id, tier_name, face_cents, seat_fee_cents, status
     from tickets where order_id = any($1::text[]) order by created_at, id`,
    [orderIds],
  );
  const netRows = await rows<{ order_id: string; net: string }>(
    db,
    `select order_id, sum(case when kind = 'purchase' then amount_cents else -amount_cents end) as net
     from payment_transactions where order_id = any($1::text[]) group by order_id`,
    [orderIds],
  );
  const paymentRows = await rows<{ order_id: string; killbill_payment_id: string }>(
    db,
    `select order_id, killbill_payment_id, min(id) as seq from payment_transactions
     where order_id = any($1::text[]) group by order_id, killbill_payment_id order by min(id)`,
    [orderIds],
  );
  return orderRows.map((order) => {
    const tickets: Ticket[] = ticketRows
      .filter((ticket) => ticket.order_id === order.id)
      .map((ticket) => ({
        id: ticket.id,
        seatId: ticket.seat_id,
        label: seatLabel(ticket.seat_id),
        tierName: ticket.tier_name,
        faceCents: ticket.face_cents,
        seatFeeCents: ticket.seat_fee_cents,
        status: ticket.status,
      }));
    const faceCents = tickets.reduce((sum, ticket) => sum + ticket.faceCents, 0);
    const seatFeesCents = tickets.reduce((sum, ticket) => sum + ticket.seatFeeCents, 0);
    return {
      id: order.id,
      performanceId: order.performance_id,
      performanceTitle: order.title,
      startsAtVenue: formatVenueStart(order.starts_at),
      name: order.name,
      email: order.email,
      status: order.status,
      tickets,
      faceCents,
      seatFeesCents,
      orderFeeCents: order.order_fee_cents,
      totalCents: faceCents + seatFeesCents + order.order_fee_cents,
      netPaidCents: Number(netRows.find((net) => net.order_id === order.id)?.net ?? 0),
      receipt: order.receipt,
      createdAt: toIsoSeconds(order.created_at),
      killbillAccountId: order.killbill_account_id,
      killbillPaymentIds: paymentRows
        .filter((payment) => payment.order_id === order.id)
        .map((payment) => payment.killbill_payment_id),
    };
  });
}

export function publicOrder(order: OwnerOrder): Order {
  const { killbillAccountId: _accountId, killbillPaymentIds: _paymentIds, ...rest } = order;
  return rest;
}

export async function loadOrder(db: Db, orderId: string, buyerId?: string): Promise<OwnerOrder | undefined> {
  const found = await loadOrders(db, {
    orderId,
    ...(buyerId === undefined ? {} : { buyerId }),
    includeCancelled: true,
  });
  return found[0];
}
