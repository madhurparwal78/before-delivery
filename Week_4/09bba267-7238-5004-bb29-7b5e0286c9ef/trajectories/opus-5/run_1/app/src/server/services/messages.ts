import { formatMoney } from '../../shared/money';
import { formatVenueExpiry, formatVenueStart } from '../../shared/venueTime';
import type { OutboxKind } from '../../shared/api';
import { config } from '../config';

export interface DraftMessage {
  readonly recipient: string;
  readonly subject: string;
  readonly kind: OutboxKind;
  readonly body: string;
}

export interface ReceiptTicketLine {
  readonly label: string;
  readonly tierName: string;
  readonly faceCents: number;
  readonly seatFeeCents: number;
}

export function receiptMessage(input: {
  readonly orderId: string;
  readonly email: string;
  readonly performanceTitle: string;
  readonly startsAt: Date;
  readonly tickets: readonly ReceiptTicketLine[];
  readonly orderFeeCents: number;
  readonly totalCents: number;
}): DraftMessage {
  const lines = [
    `Order ${input.orderId}`,
    input.performanceTitle,
    formatVenueStart(input.startsAt),
    ...input.tickets.map(
      (ticket) =>
        `${ticket.label} (${ticket.tierName}): face ${formatMoney(ticket.faceCents)}, fee ${formatMoney(
          ticket.seatFeeCents,
        )}`,
    ),
    `Order fee ${formatMoney(input.orderFeeCents)}`,
    `Total ${formatMoney(input.totalCents)}`,
  ];
  return {
    recipient: input.email,
    subject: `Your Halyard Hall tickets: order ${input.orderId}`,
    kind: 'receipt',
    body: `${lines.join('\n')}\n`,
  };
}

export function offerMessage(input: {
  readonly email: string;
  readonly seatLabel: string;
  readonly performanceTitle: string;
  readonly startsAt: Date;
  readonly totalCents: number;
  readonly expiresAt: Date;
  readonly token: string;
}): DraftMessage {
  const lines = [
    input.seatLabel,
    input.performanceTitle,
    formatVenueStart(input.startsAt),
    `Total ${formatMoney(input.totalCents)}`,
    `Accept by ${formatVenueExpiry(input.expiresAt)}`,
    `${config.publicUrl}/offers/${input.token}`,
  ];
  return {
    recipient: input.email,
    subject: `A seat is offered to you: ${input.performanceTitle}`,
    kind: 'offer',
    body: `${lines.join('\n')}\n`,
  };
}

export function exchangeMessage(input: {
  readonly orderId: string;
  readonly email: string;
  readonly oldLabel: string;
  readonly newLabel: string;
  readonly differenceCents: number;
}): DraftMessage {
  const difference =
    input.differenceCents > 0
      ? `Charged ${formatMoney(input.differenceCents)}`
      : input.differenceCents < 0
        ? `Refunded ${formatMoney(-input.differenceCents)}`
        : 'No price difference';
  const lines = [`Order ${input.orderId}`, `From ${input.oldLabel}`, `To ${input.newLabel}`, difference];
  return {
    recipient: input.email,
    subject: `Your seat exchange: order ${input.orderId}`,
    kind: 'exchange',
    body: `${lines.join('\n')}\n`,
  };
}

export function refundMessage(input: {
  readonly orderId: string;
  readonly email: string;
  readonly labels: readonly string[];
  readonly orderFeeRefunded: boolean;
  readonly refundCents: number;
}): DraftMessage {
  const lines = [
    `Order ${input.orderId}`,
    ...input.labels,
    ...(input.orderFeeRefunded ? ['Order fee refunded'] : []),
    `Refunded ${formatMoney(input.refundCents)}`,
  ];
  return {
    recipient: input.email,
    subject: `Your refund: order ${input.orderId}`,
    kind: 'refund',
    body: `${lines.join('\n')}\n`,
  };
}
