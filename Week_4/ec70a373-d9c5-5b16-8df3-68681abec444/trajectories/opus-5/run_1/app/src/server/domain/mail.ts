import type { PoolClient } from 'pg';
import { nowMs } from '../clock';
import { DOCUMENT_TYPE_LABELS, type DocumentType } from '../../shared/types';
import { formatHours, formatMoney } from './rules';
import { localDateOf, localTimeOf } from '../../shared/tz';

export interface Queued {
  dedupeKey: string;
  to: string;
  subject: string;
  body: string;
}

/** Each message is written to the outbox in the same commit as its event, exactly once. */
export async function queueMail(client: PoolClient, mail: Queued): Promise<void> {
  await client.query(
    `insert into outbox (dedupe_key, to_email, subject, body, created_at)
     values ($1,$2,$3,$4,$5) on conflict (dedupe_key) do nothing`,
    [mail.dedupeKey, mail.to, mail.subject, mail.body, new Date(nowMs()).toISOString()],
  );
}

export interface BookingMailFacts {
  bookingId: string;
  memberEmail: string;
  stationName: string;
  siteName: string;
  date: string;
  start: string;
  end: string;
  reference: string;
  quarters: number;
  availableQuartersAfter: number;
}

export async function queueBookingConfirmed(
  client: PoolClient,
  facts: BookingMailFacts,
): Promise<void> {
  await queueMail(client, {
    dedupeKey: `booking_confirmed:${facts.bookingId}`,
    to: facts.memberEmail,
    subject: `Booking confirmed: ${facts.stationName}, ${facts.date} ${facts.start}-${facts.end}`,
    body: [
      `Your booking at ${facts.siteName} is confirmed.`,
      `Site: ${facts.siteName}`,
      `Station: ${facts.stationName}`,
      `When: ${facts.date} ${facts.start}-${facts.end} site time`,
      `Reference: ${facts.reference}`,
      `Hours: ${formatHours(facts.quarters)}`,
      `Available pack hours after this booking: ${formatHours(facts.availableQuartersAfter)}`,
    ].join('\n'),
  });
}

export interface SeriesMailFacts {
  seriesId: string;
  memberEmail: string;
  stationName: string;
  siteName: string;
  weekday: string;
  start: string;
  end: string;
  weeks: number;
  dates: string[];
  totalQuarters: number;
}

export async function queueSeriesBooked(
  client: PoolClient,
  facts: SeriesMailFacts,
): Promise<void> {
  await queueMail(client, {
    dedupeKey: `series_booked:${facts.seriesId}`,
    to: facts.memberEmail,
    subject: `Weekly booking confirmed: ${facts.stationName}, ${facts.weekday}s ${facts.start}-${facts.end}, ${facts.weeks} weeks`,
    body: [
      `Your weekly slot at ${facts.siteName} is confirmed.`,
      `Station: ${facts.stationName}`,
      `Every ${facts.weekday} ${facts.start}-${facts.end} site time`,
      'Occurrences:',
      ...facts.dates.map((date) => `  ${date}`),
      `Total hours: ${formatHours(facts.totalQuarters)}`,
    ].join('\n'),
  });
}

export interface CancellationMailFacts {
  bookingId: string;
  memberEmail: string;
  stationName: string;
  siteName: string;
  date: string;
  start: string;
  end: string;
  reference: string;
  refundedQuarters: number;
  forfeitedQuarters: number;
  managerReason: string | null;
}

export async function queueBookingCancelled(
  client: PoolClient,
  facts: CancellationMailFacts,
): Promise<void> {
  const lines = [
    `Your booking at ${facts.siteName} is cancelled.`,
    `Station: ${facts.stationName}`,
    `When: ${facts.date} ${facts.start}-${facts.end} site time`,
    `Reference: ${facts.reference}`,
    `Refunded pack hours: ${formatHours(facts.refundedQuarters)}`,
    `Forfeited pack hours: ${formatHours(facts.forfeitedQuarters)}`,
  ];
  if (facts.managerReason !== null) {
    lines.push(`Cancelled by ${facts.siteName} staff. Reason: ${facts.managerReason}`);
  }
  await queueMail(client, {
    dedupeKey: `booking_cancelled:${facts.bookingId}`,
    to: facts.memberEmail,
    subject: `Booking cancelled: ${facts.stationName}, ${facts.date} ${facts.start}-${facts.end}`,
    body: lines.join('\n'),
  });
}

export interface ReceiptMailFacts {
  purchaseId: string;
  memberEmail: string;
  packName: string;
  quarters: number;
  priceCents: number;
  validThrough: string;
  availableQuartersAfter: number;
}

export async function queuePackReceipt(
  client: PoolClient,
  facts: ReceiptMailFacts,
): Promise<void> {
  await queueMail(client, {
    dedupeKey: `pack_receipt:${facts.purchaseId}`,
    to: facts.memberEmail,
    subject: `Receipt: ${facts.packName} (${formatHours(facts.quarters)} pack hours)`,
    body: [
      `Thank you for your purchase of ${facts.packName}.`,
      `Amount: $${formatMoney(facts.priceCents)}`,
      `Purchase id: ${facts.purchaseId}`,
      `Valid through ${facts.validThrough}`,
      `Available pack hours after this purchase: ${formatHours(facts.availableQuartersAfter)}`,
    ].join('\n'),
  });
}

export async function queueExpiryNotice(
  client: PoolClient,
  facts: {
    memberId: string;
    memberEmail: string;
    documentType: DocumentType;
    validThrough: string;
    kind: '14-day' | '3-day';
  },
): Promise<void> {
  const label = DOCUMENT_TYPE_LABELS[facts.documentType];
  await queueMail(client, {
    dedupeKey: `notice:${facts.memberId}:${facts.documentType}:${facts.validThrough}:${facts.kind}`,
    to: facts.memberEmail,
    subject: `${label} expires ${facts.validThrough} (${facts.kind} notice)`,
    body: [
      `Your ${label.toLowerCase()} is valid through ${facts.validThrough}.`,
      'Upload a current document on the Documents screen so your kitchen manager can verify it.',
    ].join('\n'),
  });
}

export async function queueInspectorLink(
  client: PoolClient,
  facts: {
    linkId: string;
    inspectorEmail: string;
    truckName: string;
    siteName: string;
    timeZone: string;
    url: string;
    expiresAtMs: number;
  },
): Promise<void> {
  const date = localDateOf(facts.timeZone, facts.expiresAtMs);
  const time = localTimeOf(facts.timeZone, facts.expiresAtMs);
  await queueMail(client, {
    dedupeKey: `inspector_link:${facts.linkId}`,
    to: facts.inspectorEmail,
    subject: `Commissary visit log: ${facts.truckName}`,
    body: [
      `Commissary visit log for ${facts.truckName}.`,
      `Commissary: ${facts.siteName}`,
      `Link: ${facts.url}`,
      `This link works until ${date} ${time} ${facts.timeZone}.`,
    ].join('\n'),
  });
}
