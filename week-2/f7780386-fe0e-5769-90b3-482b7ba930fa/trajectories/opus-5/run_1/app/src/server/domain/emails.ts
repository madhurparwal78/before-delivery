import { formatHours, formatMoney } from '../../shared/format.js';
import { formatClock } from '../../shared/time.js';
import type { Queryable } from './kitchen.js';

/**
 * Outbound mail is queued with a dedupe key naming the state change it
 * reports, so retries, replays and repeated sweeps never produce a second copy.
 */
export async function enqueueEmail(
  db: Queryable,
  dedupeKey: string,
  to: string,
  subject: string,
  body: string,
  now: Date,
): Promise<void> {
  await db.query(
    `INSERT INTO email_outbox (dedupe_key, to_address, subject, body, status, created_at)
     VALUES ($1, $2, $3, $4, 'queued', $5)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [dedupeKey, to, subject, body, now],
  );
}

export interface BookingMailFacts {
  bookingId: string;
  stationName: string;
  date: string;
  startMinutes: number;
  endMinutes: number;
  tailEndMinutes: number;
  prepaidMinutes: number;
  overageCents: number;
  paymentPending: boolean;
}

export function bookingConfirmationEmail(facts: BookingMailFacts): {
  dedupeKey: string;
  subject: string;
  body: string;
} {
  const lines = [
    facts.stationName,
    facts.date,
    `${formatClock(facts.startMinutes)}–${formatClock(facts.endMinutes)}`,
    `Cleaning turnover until ${formatClock(facts.tailEndMinutes)}`,
    `Prepaid hours used: ${formatHours(facts.prepaidMinutes)}`,
    `Overage: $${formatMoney(facts.overageCents)}`,
  ];
  if (facts.paymentPending) lines.push('Payment pending');
  return {
    dedupeKey: `booking-confirmed:${facts.bookingId}`,
    subject: `Booking confirmed: ${facts.stationName} on ${facts.date}`,
    body: lines.join('\n'),
  };
}

export function cancellationReceiptEmail(facts: {
  bookingId: string;
  stationName: string;
  date: string;
  refundedMinutes: number;
  feeCents: number | null;
}): { dedupeKey: string; subject: string; body: string } {
  const lines = [
    facts.stationName,
    facts.date,
    `Hours returned: ${formatHours(facts.refundedMinutes)}`,
    facts.feeCents === null
      ? 'No cancellation fee'
      : `Late-cancellation fee: $${formatMoney(facts.feeCents)}`,
  ];
  return {
    dedupeKey: `booking-cancelled:${facts.bookingId}`,
    subject: `Booking cancelled: ${facts.stationName} on ${facts.date}`,
    body: lines.join('\n'),
  };
}

export function documentLabel(kind: string, crewCookName: string | null): string {
  return kind === 'liability_insurance'
    ? 'Liability insurance'
    : `Food handler card – ${crewCookName ?? ''}`;
}

export function expiryWarningEmail(facts: {
  documentId: string;
  kind: string;
  crewCookName: string | null;
  expiresOn: string;
  days: 14 | 3;
}): { dedupeKey: string; subject: string; body: string } {
  const label = documentLabel(facts.kind, facts.crewCookName);
  return {
    dedupeKey: `doc-warning:${facts.documentId}:${facts.days}`,
    subject: `Certificate expires in ${facts.days} days: ${label}`,
    body: `${label}\nExpires on ${facts.expiresOn}`,
  };
}

export function invoiceNoticeEmail(facts: {
  chargeKey: string;
  description: string;
  amountCents: number;
}): { dedupeKey: string; subject: string; body: string } {
  return {
    dedupeKey: `invoice-notice:${facts.chargeKey}`,
    subject: `Invoice notice: $${formatMoney(facts.amountCents)} for ${facts.description}`,
    body: `${facts.description}\nAmount: $${formatMoney(facts.amountCents)}`,
  };
}
