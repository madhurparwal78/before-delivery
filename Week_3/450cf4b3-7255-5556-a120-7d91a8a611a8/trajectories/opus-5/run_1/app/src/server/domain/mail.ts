import { query, queryOne, type Db } from '../db';
import { config } from '../config';
import { kitchenIso, kitchenTimeZone } from '../kitchen-time';
import { formatDateLabel, formatDuration, formatMoney, isoDate, isoTime } from '../../shared/format';
import type { BookingEmailKind, DeliveryStatus, DocumentKind, NoticePoint } from '../../shared/types';

export type MailKind =
  | BookingEmailKind
  | 'pack_receipt'
  | 'notice_seven_days'
  | 'notice_today';

export interface MailRecipient {
  contactName: string;
  email: string;
}

export interface QueuedMailRow {
  id: string;
  kind: string;
  record_id: string | null;
  status: DeliveryStatus;
  sent_at: Date | null;
}

export interface DeliveryState {
  status: DeliveryStatus;
  sentAt: string | null;
}

/** The one rule giving the delivery status of every queued email. */
export function deliveryStateOf(row: Pick<QueuedMailRow, 'status' | 'sent_at'> | null): DeliveryState | null {
  if (row === null) return null;
  if (row.status === 'sent' && row.sent_at !== null) {
    return { status: 'sent', sentAt: kitchenIso(row.sent_at) };
  }
  return { status: 'queued', sentAt: null };
}

export async function queueMail(
  client: Db,
  kind: MailKind,
  recordId: string,
  recipient: MailRecipient,
  subject: string,
  body: string,
): Promise<void> {
  await query(
    client,
    `insert into mail_queue (kind, record_id, to_name, to_email, subject, body, status)
     values ($1,$2,$3,$4,$5,$6,'queued')`,
    [kind, recordId, recipient.contactName, recipient.email, subject, body],
  );
}

export async function mailRowsFor(
  client: Db,
  recordId: string,
  kinds: ReadonlyArray<MailKind>,
): Promise<QueuedMailRow[]> {
  return query<QueuedMailRow>(
    client,
    `select id::text as id, kind, record_id, status, sent_at from mail_queue
     where record_id = $1 and kind = any($2::text[]) order by id`,
    [recordId, kinds as unknown as string[]],
  );
}

export async function mailRowFor(
  client: Db,
  recordId: string,
  kind: MailKind,
): Promise<QueuedMailRow | null> {
  return queryOne<QueuedMailRow>(
    client,
    `select id::text as id, kind, record_id, status, sent_at from mail_queue
     where record_id = $1 and kind = $2 order by id limit 1`,
    [recordId, kind],
  );
}

export interface BookingMailFacts {
  stationName: string;
  shelfName: string | null;
  startIso: string;
  endIso: string;
  minutes: number;
  packBalanceMinutes: number;
  bookingId: string;
}

function bookingLines(facts: BookingMailFacts): string[] {
  const date = formatDateLabel(isoDate(facts.startIso));
  return [
    `Station: ${facts.stationName}`,
    `Shelf: ${facts.shelfName ?? 'none'}`,
    `Starts: ${date} ${isoTime(facts.startIso)} ${kitchenTimeZone}`,
    `Ends: ${formatDateLabel(isoDate(facts.endIso))} ${isoTime(facts.endIso)} ${kitchenTimeZone}`,
    `Hours debited: ${formatDuration(facts.minutes)}`,
    `Pack balance: ${formatDuration(facts.packBalanceMinutes)}`,
    `Booking reference: ${facts.bookingId}`,
  ];
}

export function bookingConfirmedMail(facts: BookingMailFacts): { subject: string; body: string } {
  return {
    subject: `Booking confirmed: ${facts.stationName} on ${formatDateLabel(isoDate(facts.startIso))}`,
    body: bookingLines(facts).join('\n'),
  };
}

export interface BookingMoveMailFacts extends BookingMailFacts {
  previousStartIso: string;
  previousEndIso: string;
  previousStationName: string;
  previousShelfName: string | null;
}

export function bookingMovedMail(facts: BookingMoveMailFacts): { subject: string; body: string } {
  const previousStations =
    facts.previousShelfName === null
      ? facts.previousStationName
      : `${facts.previousStationName} and ${facts.previousShelfName}`;
  const was =
    `Was: ${formatDateLabel(isoDate(facts.previousStartIso))} ` +
    `${isoTime(facts.previousStartIso)}\u2013${isoTime(facts.previousEndIso)} ${previousStations}`;
  return {
    subject: `Booking moved: ${facts.stationName} on ${formatDateLabel(isoDate(facts.startIso))}`,
    body: [...bookingLines(facts), was].join('\n'),
  };
}

export function packReceiptMail(facts: {
  hours: number;
  priceCents: number;
  invoiceId: string;
  purchasedAtIso: string;
}): { subject: string; body: string } {
  return {
    subject: `Receipt: ${facts.hours}-hour pack`,
    body: [
      `Hours added: ${facts.hours} h`,
      `Amount: $${formatMoney(facts.priceCents)}`,
      `Invoice: ${facts.invoiceId}`,
      `Purchased: ${formatDateLabel(isoDate(facts.purchasedAtIso))} ${isoTime(facts.purchasedAtIso)} ${kitchenTimeZone}`,
    ].join('\n'),
  };
}

export function documentKindLabel(kind: DocumentKind): string {
  return kind === 'insurance_certificate' ? 'certificate of insurance' : 'food-handler card';
}

export function expiryNoticeMail(
  kind: DocumentKind,
  point: NoticePoint,
  expiresOn: string,
): { subject: string; body: string } {
  const label = documentKindLabel(kind);
  const date = formatDateLabel(expiresOn);
  return {
    subject: point === 'seven_days' ? `Your ${label} expires in 7 days` : `Your ${label} expires today`,
    body: [
      `Expires: ${date} at 23:59 ${kitchenTimeZone}`,
      `Bookings after ${date} will be refused until a renewed document is on file.`,
    ].join('\n'),
  };
}

export function mailKindOfNotice(point: NoticePoint): MailKind {
  return point === 'seven_days' ? 'notice_seven_days' : 'notice_today';
}

export function senderAddress(): string {
  const header = config.mail.from;
  const match = /<([^>]+)>/.exec(header);
  return match?.[1] ?? header.trim();
}
