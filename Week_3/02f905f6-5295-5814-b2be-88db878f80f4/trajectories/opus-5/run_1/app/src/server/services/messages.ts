import type { Quote, SidesIn } from '../../shared/types';
import { formatMoney } from '../../shared/labels';
import type { Message } from './mail';

function sidesLines(sides: SidesIn): string[] {
  const lines: string[] = [];
  if (sides.length) lines.push(`Length ${sides.length} in`);
  if (sides.width) lines.push(`Width ${sides.width} in`);
  if (sides.diameter) lines.push(`Diameter ${sides.diameter} in`);
  lines.push(`Height ${sides.height} in`);
  return lines;
}

export function intakeReceipt(args: {
  to: string;
  pieceNumber: string;
  quote: Quote;
  trackingUrl: string | null;
}): Message {
  const { quote } = args;
  const lines = [
    `Piece ${args.pieceNumber}`,
    '',
    ...sidesLines(quote.sides_in),
    `Cubic inches ${quote.cubic_inches} in³`,
    `Rate $${quote.rate_per_cubic_inch} per in³`,
    `Member discount ${quote.discount_percent}%`,
    `Order minimum $${formatMoney(quote.order_minimum_cents)} applied: ${
      quote.minimum_applied ? 'yes' : 'no'
    }`,
    `Fee $${formatMoney(quote.fee_cents)}`,
  ];
  if (args.trackingUrl) {
    lines.push('', `Amount due $${formatMoney(quote.fee_cents)}`, `Track your piece: ${args.trackingUrl}`);
  }
  return {
    to: args.to,
    subject: `Intake receipt: Piece ${args.pieceNumber}`,
    body: lines.join('\n'),
  };
}

export function readyNotice(args: {
  to: string;
  pieceNumber: string;
  pickupShelf: string;
  trackingUrl: string | null;
}): Message {
  const lines = [
    'Your piece is ready on the pickup shelf',
    '',
    `Piece ${args.pieceNumber}`,
    `Pickup shelf ${args.pickupShelf}`,
  ];
  if (args.trackingUrl) lines.push('', `Track your piece: ${args.trackingUrl}`);
  return {
    to: args.to,
    subject: `Ready on pickup shelf: Piece ${args.pieceNumber}`,
    body: lines.join('\n'),
  };
}

export function pickupReminder(args: {
  to: string;
  pieceNumber: string;
  pickupShelf: string;
  daysWaiting: number;
}): Message {
  return {
    to: args.to,
    subject: `Still on the pickup shelf: Piece ${args.pieceNumber}`,
    body: [
      `Piece ${args.pieceNumber} is still on the pickup shelf.`,
      '',
      `Pickup shelf ${args.pickupShelf}`,
      `Days waiting ${args.daysWaiting}`,
    ].join('\n'),
  };
}

export function newTrackingLink(args: {
  to: string;
  pieceNumber: string;
  trackingUrl: string;
}): Message {
  return {
    to: args.to,
    subject: `New tracking link for Piece ${args.pieceNumber}`,
    body: [
      `Piece ${args.pieceNumber} has a new tracking link.`,
      '',
      `Track your piece: ${args.trackingUrl}`,
    ].join('\n'),
  };
}
