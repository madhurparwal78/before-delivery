import type { Order } from '../../shared/api';
import { hallSeat, seatLabel, sortSeatIds } from '../../shared/hall';
import { seatFeeCents } from '../../shared/money';
import { first, withTransaction } from '../db';
import { buyerTopic, performanceTopic, recordChange } from '../live';
import { exchangeMessage } from '../services/messages';
import { enqueueMessage } from '../services/outbox';
import { loadOrder, publicOrder, refreshOrderStatus } from './orders';
import { CHANGES_OPEN_SQL } from './rules';
import { chargeExtra, giveBack } from './payments';
import { freeSeat, holdSeatRow, lockSeatRows, markPaymentPending, markSeatSold, releaseExpiredHolds } from './seats';

export type ExchangeResult =
  | { readonly kind: 'done'; readonly order: Order; readonly differenceCents: number }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'changes_closed' }
  | { readonly kind: 'ticket_not_issued' }
  | { readonly kind: 'seat_taken'; readonly seatId: string }
  | { readonly kind: 'invalid_seat' }
  | { readonly kind: 'declined' }
  | { readonly kind: 'unavailable' };

interface TicketRow {
  id: string;
  order_id: string;
  performance_id: string;
  seat_id: string;
  face_cents: number;
  seat_fee_cents: number;
  status: string;
  changes_open: boolean;
  email: string;
  name: string;
}

export async function exchangeTicket(input: {
  readonly ticketId: string;
  readonly buyerId: string;
  readonly newSeatId: string;
}): Promise<ExchangeResult> {
  const found = await withTransaction((db) =>
    first<{ performance_id: string }>(
      db,
      `select tk.performance_id from tickets tk join orders o on o.id = tk.order_id
       where tk.id = $1 and o.buyer_id = $2`,
      [input.ticketId, input.buyerId],
    ),
  );
  if (!found) return { kind: 'not_found' };
  const performanceId = found.performance_id;
  await withTransaction((db) => releaseExpiredHolds(db, performanceId));

  const prepared = await withTransaction(async (db) => {
    const ticket = await first<TicketRow>(
      db,
      `select tk.id, tk.order_id, tk.performance_id, tk.seat_id, tk.face_cents, tk.seat_fee_cents, tk.status,
              (${CHANGES_OPEN_SQL}) as changes_open, o.email, o.name
       from tickets tk
       join orders o on o.id = tk.order_id
       join performances p on p.id = tk.performance_id
       where tk.id = $1 and o.buyer_id = $2
       for update of tk`,
      [input.ticketId, input.buyerId],
    );
    if (!ticket) return { kind: 'not_found' } as const;
    if (!ticket.changes_open) return { kind: 'changes_closed' } as const;
    if (ticket.status !== 'issued') return { kind: 'ticket_not_issued' } as const;
    if (hallSeat(input.newSeatId) === undefined || input.newSeatId === ticket.seat_id) {
      return { kind: 'invalid_seat' } as const;
    }
    const seatRows = await lockSeatRows(db, performanceId, sortSeatIds([ticket.seat_id, input.newSeatId]));
    const newSeat = seatRows.find((row) => row.seat_id === input.newSeatId);
    if (!newSeat || newSeat.tier_id === null) return { kind: 'invalid_seat' } as const;
    if (newSeat.effective_state !== 'on_sale') return { kind: 'seat_taken', seatId: input.newSeatId } as const;
    const tier = await first<{ name: string; face_cents: number }>(
      db,
      `select name, face_cents from tiers where performance_id = $1 and tier_id = $2`,
      [performanceId, newSeat.tier_id],
    );
    if (!tier) return { kind: 'invalid_seat' } as const;
    const newFaceCents = tier.face_cents;
    const newSeatFeeCents = seatFeeCents(newFaceCents);
    const differenceCents = newFaceCents + newSeatFeeCents - (ticket.face_cents + ticket.seat_fee_cents);
    await db.query(`update tickets set status = 'exchange_pending' where id = $1`, [ticket.id]);
    await holdSeatRow(db, performanceId, input.newSeatId, input.buyerId, 'exchange', null);
    await markPaymentPending(db, performanceId, [input.newSeatId], ticket.order_id);
    await recordChange(db, [performanceTopic(performanceId), buyerTopic(input.buyerId)]);
    return {
      kind: 'prepared',
      ticket,
      tierId: newSeat.tier_id,
      tierName: tier.name,
      newFaceCents,
      newSeatFeeCents,
      differenceCents,
    } as const;
  });
  if (prepared.kind !== 'prepared') return prepared;

  const { ticket, differenceCents } = prepared;
  const settlement =
    differenceCents > 0
      ? await chargeExtra({
          orderId: ticket.order_id,
          email: ticket.email,
          name: ticket.name,
          amountCents: differenceCents,
        })
      : differenceCents < 0
        ? await giveBack({ orderId: ticket.order_id, amountCents: -differenceCents })
        : 'confirmed';

  return withTransaction(async (db) => {
    await lockSeatRows(db, performanceId, sortSeatIds([ticket.seat_id, input.newSeatId]));
    await markPaymentPending(db, performanceId, [input.newSeatId], null);
    const topics = [performanceTopic(performanceId), buyerTopic(input.buyerId)];
    if (settlement !== 'confirmed') {
      await db.query(`update tickets set status = 'issued' where id = $1`, [ticket.id]);
      await freeSeat(db, performanceId, input.newSeatId);
      await recordChange(db, topics);
      return { kind: settlement === 'declined' ? 'declined' : 'unavailable' } as const;
    }
    await db.query(
      `update tickets set seat_id = $2, tier_id = $3, tier_name = $4, face_cents = $5, seat_fee_cents = $6,
         status = 'issued'
       where id = $1`,
      [
        ticket.id,
        input.newSeatId,
        prepared.tierId,
        prepared.tierName,
        prepared.newFaceCents,
        prepared.newSeatFeeCents,
      ],
    );
    await markSeatSold(db, performanceId, input.newSeatId);
    await freeSeat(db, performanceId, ticket.seat_id);
    await refreshOrderStatus(db, ticket.order_id);
    await enqueueMessage(
      db,
      exchangeMessage({
        orderId: ticket.order_id,
        email: ticket.email,
        oldLabel: seatLabel(ticket.seat_id),
        newLabel: seatLabel(input.newSeatId),
        differenceCents,
      }),
    );
    await recordChange(db, topics);
    const order = await loadOrder(db, ticket.order_id, input.buyerId);
    return order
      ? ({ kind: 'done', order: publicOrder(order), differenceCents } as const)
      : ({ kind: 'unavailable' } as const);
  });
}
