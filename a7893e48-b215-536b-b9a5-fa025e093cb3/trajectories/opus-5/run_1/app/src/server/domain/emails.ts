import type { DocumentKind } from '../../shared/types.js';
import type { QueuedEmail } from '../services/mail.js';
import { formatAmount, formatHours, termsLine } from './format.js';
import type { BookingRow } from './records.js';
import { localDate, localStamp, localTime, zoneAbbrev } from './zone.js';

export const DOCUMENT_TITLES: Record<DocumentKind, string> = {
  liability: 'liability certificate',
  food_handler: 'food handler card',
};

function bookingLines(row: BookingRow): string[] {
  const zone = zoneAbbrev(row.time_zone, row.start_at);
  const endZone = zoneAbbrev(row.time_zone, row.end_at);
  const lines = [
    `${localDate(row.time_zone, row.start_at)} ${localTime(row.time_zone, row.start_at)} ${zone} to ${localTime(row.time_zone, row.end_at)} ${endZone}`,
    `Hours: ${formatHours(row.minutes)} h`,
    `Pack hours used: ${formatHours(row.pack_minutes)} h`,
    `Card charged now: $${formatAmount(row.time_paid ? row.card_cents : 0)}`,
    `Deposit: $${formatAmount(row.deposit_cents)}`,
  ];
  if (!row.time_paid && row.card_cents > 0 && row.balance_due_by !== null) {
    lines.push(
      `Balance due: $${formatAmount(row.card_cents)} by ${localStamp(row.time_zone, row.balance_due_by)}`,
    );
  }
  return lines;
}

export function confirmationEmail(holdId: string, bookings: readonly BookingRow[]): QueuedEmail {
  const first = bookings[0];
  if (first === undefined) throw new Error('confirmation needs at least one booking');
  const firstDate = localDate(first.time_zone, first.start_at);
  const subject =
    bookings.length === 1
      ? `Booking confirmed: ${first.station_name} on ${firstDate}`
      : `Booking confirmed: ${first.station_name}, ${bookings.length} dates from ${firstDate}`;
  const body = [
    first.site_name,
    `Station: ${first.station_name}`,
    '',
    ...bookings.flatMap((row) => [...bookingLines(row), '']),
    termsLine(first.notice_hours),
  ].join('\n');
  return { dedupeKey: `confirmation-${holdId}`, to: first.renter_email, subject, body };
}

export interface HoldExpiryInput {
  holdId: string;
  renterEmail: string;
  stationName: string;
  siteName: string;
  timeZone: string;
  startAt: Date;
}

export function holdExpiredEmail(input: HoldExpiryInput): QueuedEmail {
  const date = localDate(input.timeZone, input.startAt);
  return {
    dedupeKey: `hold-expired-${input.holdId}`,
    to: input.renterEmail,
    subject: `Hold expired: ${input.stationName} on ${date}`,
    body: `Your hold on ${input.stationName} at ${input.siteName} for ${date} ${localTime(input.timeZone, input.startAt)} ${zoneAbbrev(input.timeZone, input.startAt)} ran out and the time was released.`,
  };
}

export function unpaidCancellationEmail(row: BookingRow): QueuedEmail {
  const date = localDate(row.time_zone, row.start_at);
  const cutoff = row.balance_due_by === null ? '' : localStamp(row.time_zone, row.balance_due_by);
  return {
    dedupeKey: `unpaid-${row.id}`,
    to: row.renter_email,
    subject: `Booking cancelled: balance unpaid for ${row.station_name} on ${date}`,
    body: [
      `${row.site_name} — ${row.station_name}`,
      `The card balance of $${formatAmount(row.card_cents)} was still unpaid at the cutoff of ${cutoff}, so the booking was cancelled.`,
      `The $${formatAmount(row.deposit_cents)} deposit was kept.`,
      `Pack hours returned: ${formatHours(row.pack_minutes)} h`,
    ].join('\n'),
  };
}

export interface ReminderInput {
  documentId: string;
  renterEmail: string;
  kind: DocumentKind;
  expiresOn: string;
}

export function expiryReminderEmail(input: ReminderInput): QueuedEmail {
  const title = input.kind === 'liability' ? 'Your liability certificate' : 'Your food handler card';
  return {
    dedupeKey: `document-reminder-${input.documentId}`,
    to: input.renterEmail,
    subject: `${title} expires on ${input.expiresOn}`,
    body: `${title} on file expires on ${input.expiresOn}. Upload a current one to keep booking station time.`,
  };
}
