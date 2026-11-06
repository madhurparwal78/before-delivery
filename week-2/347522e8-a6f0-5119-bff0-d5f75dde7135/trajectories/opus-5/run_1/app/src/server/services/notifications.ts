/**
 * The notification outbox. Every email the app sends is written in the same
 * database transaction as the action that causes it, and the sender delivers
 * each one exactly once.
 */

import type { Db } from '../db.js';
import { EN_DASH, formatHours } from '../../shared/format.js';
import { DOCUMENT_LABELS } from '../../shared/copy.js';
import { MINUTE_MS, kitchenHhmm, kitchenZoneAbbrev } from '../../shared/kitchenTime.js';
import type { DocumentKind } from '../../shared/types.js';

export type NotificationKind =
  | 'receipt'
  | 'booking_confirmed'
  | 'hold_expired'
  | 'booking_displaced'
  | 'document_expiring'
  | 'document_expired';

export interface QueuedNotification {
  kind: NotificationKind;
  /** The action that causes the email. */
  cause: string;
  to: string;
  subject: string;
  body: string;
}

export async function queueNotification(
  tx: Db,
  notification: QueuedNotification,
): Promise<void> {
  await tx.query(
    `INSERT INTO notifications (kind, cause, to_email, subject, body, status)
     VALUES ($1, $2, $3, $4, $5, 'queued')`,
    [
      notification.kind,
      notification.cause,
      notification.to,
      notification.subject,
      notification.body,
    ],
  );
}

export interface ReceiptFacts {
  to: string;
  packName: string;
  amountUsd: string;
  hours: number;
  killbillPaymentId: string;
  balanceMinutes: number;
}

export function receiptMail(facts: ReceiptFacts): QueuedNotification {
  return {
    kind: 'receipt',
    cause: 'pack_purchase',
    to: facts.to,
    subject: `Receipt for your ${facts.packName}`,
    body: [
      `Thank you for your ${facts.packName}.`,
      '',
      `Amount paid: $${facts.amountUsd}`,
      `Hours added: ${facts.hours}`,
      `Kill Bill payment id: ${facts.killbillPaymentId}`,
      `New balance: ${formatHours(facts.balanceMinutes)} h`,
      '',
      'Brigade & Bench Commissary',
    ].join('\n'),
  };
}

export interface ConfirmedWeek {
  date: string;
  start: string;
  end: string;
  startsAtMs: number;
  endsAtMs: number;
  bufferMinutes: number;
}

export function bookingConfirmedMail(
  to: string,
  stationName: string,
  weeks: readonly ConfirmedWeek[],
): QueuedNotification {
  const first = weeks[0];
  const lines = [`Your booking on ${stationName} is confirmed.`, ''];
  for (const week of weeks) {
    const bufferEnd = kitchenHhmm(week.endsAtMs + week.bufferMinutes * MINUTE_MS);
    lines.push(
      `${week.date} ${week.start}${EN_DASH}${week.end} ${kitchenZoneAbbrev(week.startsAtMs)}`,
    );
    lines.push(`Sanitation buffer: ${week.bufferMinutes} minutes, until ${bufferEnd}`);
  }
  lines.push('', 'Brigade & Bench Commissary');
  return {
    kind: 'booking_confirmed',
    cause: 'booking_confirmed',
    to,
    subject: `Booking confirmed: ${stationName} on ${first.date}`,
    body: lines.join('\n'),
  };
}

export function holdExpiredMail(
  to: string,
  stationName: string,
  date: string,
  start: string,
  end: string,
  minutes: number,
): QueuedNotification {
  return {
    kind: 'hold_expired',
    cause: 'hold_expiry',
    to,
    subject: `Your hold on ${stationName} has expired`,
    body: [
      `Your hold on ${stationName} for ${date} ${start}${EN_DASH}${end} was not confirmed in time, so the time has been released.`,
      '',
      `${formatHours(minutes)} hours returned to your balance.`,
      '',
      'Brigade & Bench Commissary',
    ].join('\n'),
  };
}

export function bookingDisplacedMail(
  to: string,
  stationName: string,
  date: string,
  start: string,
  end: string,
  minutes: number,
  reason: string,
): QueuedNotification {
  return {
    kind: 'booking_displaced',
    cause: 'maintenance_block',
    to,
    subject: `Booking displaced: ${stationName} on ${date}`,
    body: [
      `Your booking on ${stationName} for ${date} ${start}${EN_DASH}${end} has been displaced because the station is blocked for maintenance.`,
      '',
      `Reason: ${reason}`,
      `${formatHours(minutes)} hours returned to your balance.`,
      '',
      'Brigade & Bench Commissary',
    ].join('\n'),
  };
}

export function documentExpiringMail(
  to: string,
  kind: DocumentKind,
  expiresOn: string,
): QueuedNotification {
  const label = DOCUMENT_LABELS[kind];
  return {
    kind: 'document_expiring',
    cause: 'compliance_scan',
    to,
    subject: `Your ${label} expires on ${expiresOn}`,
    body: [
      `Your ${label} on file expires on ${expiresOn}.`,
      '',
      'Upload a current replacement so your bookings are not paused.',
      '',
      'Brigade & Bench Commissary',
    ].join('\n'),
  };
}

export function documentExpiredMail(to: string, kind: DocumentKind): QueuedNotification {
  const label = DOCUMENT_LABELS[kind];
  return {
    kind: 'document_expired',
    cause: 'compliance_scan',
    to,
    subject: `Your ${label} has expired`,
    body: [
      `Your ${label} on file has expired, so new bookings are paused.`,
      '',
      'Upload a current replacement for the operator to approve.',
      '',
      'Brigade & Bench Commissary',
    ].join('\n'),
  };
}
