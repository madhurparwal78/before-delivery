import type { Order } from '../../shared/api';
import { seatLabel, sortSeatIds } from '../../shared/hall';
import { refundAmountCents } from '../../shared/money';
import { first, rows, withTransaction } from '../db';
import { buyerTopic, performanceTopic, recordChange } from '../live';
import { refundMessage } from '../services/messages';
import { enqueueMessage } from '../services/outbox';
import { loadOrder, publicOrder, refreshOrderStatus } from './orders';
import { giveBack } from './payments';
import { CHANGES_OPEN_SQL } from './rules';
import { freeSeat, lockSeatRows } from './seats';

export type RefundResult =
  | { readonly kind: 'done'; readonly order: Order; readonly refundCents: number }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'changes_closed' }
  | { readonly kind: 'ticket_not_issued' }
  | { readonly kind: 'invalid_tickets' }
  | { readonly kind: 'unavailable' };

interface OrderHeadRow {
  id: string;
  performance_id: string;
  email: string;
  changes_open: boolean;
}

interface TicketRow {
  id: string;
  seat_id: string;
  face_cents: number;
  seat_fee_cents: number;
  status: string;
}

export async function refundTickets(input: {
  readonly orderId: string;
  readonly buyerId: string;
  readonly ticketIds: readonly string[];
  readonly requestedCount: number;
}): Promise<RefundResult> {
  const prepared = await withTransaction(async (db) => {
    const order = await first<OrderHeadRow>(
      db,
      `select o.id, o.performance_id, o.email, (${CHANGES_OPEN_SQL}) as changes_open
       from orders o join performances p on p.id = o.performance_id
       where o.id = $1 and o.buyer_id = $2 and o.status <> 'cancelled'
       for update of o`,
      [input.orderId, input.buyerId],
    );
    if (!order) return { kind: 'not_found' } as const;
    if (!order.changes_open) return { kind: 'changes_closed' } as const;
    const all = await rows<TicketRow>(
      db,
      `select id, seat_id, face_cents, seat_fee_cents, status from tickets where order_id = $1
       order by created_at, id
       for update`,
      [input.orderId],
    );
    const chosen = all.filter((ticket) => input.ticketIds.includes(ticket.id));
    if (chosen.length !== input.requestedCount || chosen.length === 0) return { kind: 'invalid_tickets' } as const;
    if (chosen.some((ticket) => ticket.status !== 'issued')) return { kind: 'ticket_not_issued' } as const;
    const issuedLeft = all.filter(
      (ticket) => ticket.status === 'issued' && !input.ticketIds.includes(ticket.id),
    ).length;
    const refundCents = refundAmountCents({
      refunded: chosen.map((ticket) => ({ faceCents: ticket.face_cents, seatFeeCents: ticket.seat_fee_cents })),
      issuedTicketsLeft: issuedLeft,
    });
    await db.query(`update tickets set status = 'refund_pending' where id = any($1::uuid[])`, [
      chosen.map((ticket) => ticket.id),
    ]);
    await recordChange(db, [buyerTopic(input.buyerId)]);
    return {
      kind: 'prepared',
      order,
      chosen,
      refundCents,
      orderFeeRefunded: issuedLeft === 0,
    } as const;
  });
  if (prepared.kind !== 'prepared') return prepared;

  const settlement = await giveBack({ orderId: input.orderId, amountCents: prepared.refundCents });

  return withTransaction(async (db) => {
    const seatIds = sortSeatIds(prepared.chosen.map((ticket) => ticket.seat_id));
    await lockSeatRows(db, prepared.order.performance_id, seatIds);
    const topics = [performanceTopic(prepared.order.performance_id), buyerTopic(input.buyerId)];
    if (settlement !== 'confirmed') {
      await db.query(`update tickets set status = 'issued' where id = any($1::uuid[])`, [
        prepared.chosen.map((ticket) => ticket.id),
      ]);
      await recordChange(db, topics);
      return { kind: 'unavailable' } as const;
    }
    await db.query(`update tickets set status = 'refunded' where id = any($1::uuid[])`, [
      prepared.chosen.map((ticket) => ticket.id),
    ]);
    for (const seatId of seatIds) await freeSeat(db, prepared.order.performance_id, seatId);
    await refreshOrderStatus(db, input.orderId);
    await enqueueMessage(
      db,
      refundMessage({
        orderId: input.orderId,
        email: prepared.order.email,
        labels: seatIds.map(seatLabel),
        orderFeeRefunded: prepared.orderFeeRefunded,
        refundCents: prepared.refundCents,
      }),
    );
    await recordChange(db, topics);
    const order = await loadOrder(db, input.orderId, input.buyerId);
    return order
      ? ({ kind: 'done', order: publicOrder(order), refundCents: prepared.refundCents } as const)
      : ({ kind: 'unavailable' } as const);
  });
}
