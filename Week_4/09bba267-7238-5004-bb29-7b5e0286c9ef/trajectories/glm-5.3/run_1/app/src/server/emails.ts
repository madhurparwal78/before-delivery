import type { PoolClient } from 'pg';
import type { Mailer } from './mailer';
import { seatFeeCents, ORDER_FEE_CENTS, formatCents } from './money';
import { seatLabel } from './hall';
import { venueLabel } from './venue-time';
import type { TicketRow, OrderRow, PerformanceRow } from './state';

export async function queueReceiptEmail(
  client: PoolClient,
  mailer: Mailer,
  args: { order: OrderRow; tickets: TicketRow[]; performance: PerformanceRow },
): Promise<void> {
  const lines: string[] = [
    `Order ${args.order.id}`,
    args.performance.title,
    venueLabel(args.performance.starts_at),
  ];
  for (const ticket of args.tickets) {
    lines.push(`${seatLabel(ticket.seat_id)} (${ticket.tier_name}): face ${formatCents(ticket.face_cents)}, fee ${formatCents(ticket.seat_fee_cents)}`);
  }
  lines.push(`Order fee ${formatCents(args.order.order_fee_cents)}`);
  lines.push(`Total ${formatCents(args.order.total_cents)}`);
  await mailer.record(client, {
    to: args.order.email,
    kind: 'receipt',
    subject: `Your Halyard Hall tickets: order ${args.order.id}`,
    body: lines.join('\n'),
  });
}

export async function queueExchangeEmail(
  client: PoolClient,
  mailer: Mailer,
  args: { order: OrderRow; oldSeatId: string; newSeatId: string; differenceCents: number },
): Promise<void> {
  const differenceLine =
    args.differenceCents > 0
      ? `Charged ${formatCents(args.differenceCents)}`
      : args.differenceCents < 0
        ? `Refunded ${formatCents(-args.differenceCents)}`
        : 'No price difference';
  const body = [`From ${seatLabel(args.oldSeatId)}`, `To ${seatLabel(args.newSeatId)}`, differenceLine].join('\n');
  await mailer.record(client, {
    to: args.order.email,
    kind: 'exchange',
    subject: `Your seat exchange: order ${args.order.id}`,
    body,
  });
}

export async function queueRefundEmail(
  client: PoolClient,
  mailer: Mailer,
  args: { order: OrderRow; tickets: TicketRow[]; refundCents: number; includesOrderFee: boolean },
): Promise<void> {
  const lines: string[] = [];
  for (const ticket of args.tickets) {
    lines.push(seatLabel(ticket.seat_id));
  }
  if (args.includesOrderFee) {
    lines.push('Order fee refunded');
  }
  lines.push(`Refunded ${formatCents(args.refundCents)}`);
  await mailer.record(client, {
    to: args.order.email,
    kind: 'refund',
    subject: `Your refund: order ${args.order.id}`,
    body: lines.join('\n'),
  });
}

export function ticketAmountCents(ticket: TicketRow): number {
  return ticket.face_cents + ticket.seat_fee_cents;
}

export { seatFeeCents, ORDER_FEE_CENTS };
