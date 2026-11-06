/** Every message Lineboard sends, including the statement body layout. */
import { monthLabel } from '../../shared/calendar.js';
import { documentTypeLabel, formatHours, formatMoney, type DocumentType } from '../../shared/format.js';
import type { Queryable } from '../db/pool.js';
import { feeLine } from '../http/errors.js';

export type Message = { to: string; subject: string; body: string };

export async function queueMail(client: Queryable, message: Message): Promise<void> {
  await client.query(`insert into mail_outbox (to_email, subject, body) values ($1,$2,$3)`, [
    message.to,
    message.subject,
    message.body,
  ]);
}

export function confirmationMessage(input: {
  to: string;
  business: string;
  blockLabel: string;
  bookingId: string;
  chargeCents: number;
  month: string;
  hourly: boolean;
  balanceHours: number;
}): Message {
  const lines = [
    input.business,
    `Booking confirmed: ${input.blockLabel}`,
    `Booking id: ${input.bookingId}`,
    `Charge: ${formatMoney(input.chargeCents)} for your ${monthLabel(input.month)} statement`,
  ];
  if (input.hourly) {
    lines.push(`${formatHours(input.balanceHours)} hours left in ${monthLabel(input.month)}`);
  }
  return {
    to: input.to,
    subject: `Booking confirmed: ${input.blockLabel}`,
    body: lines.join('\r\n'),
  };
}

export function cancellationMessage(input: {
  to: string;
  business: string;
  blockLabel: string;
  bookingId: string;
  penaltyCents: number;
}): Message {
  return {
    to: input.to,
    subject: `Booking cancelled: ${input.blockLabel}`,
    body: [
      input.business,
      `Booking cancelled: ${input.blockLabel}`,
      `Booking id: ${input.bookingId}`,
      feeLine(input.penaltyCents),
    ].join('\r\n'),
  };
}

export function waiverMessage(input: {
  to: string;
  business: string;
  blockLabel: string;
  penaltyCents: number;
  creditMonth: string;
}): Message {
  return {
    to: input.to,
    subject: `Late cancellation fee waived: ${input.blockLabel}`,
    body: [
      input.business,
      `Late cancellation fee waived: ${input.blockLabel}`,
      `Credit ${formatMoney(input.penaltyCents)} on your ${monthLabel(input.creditMonth)} statement`,
    ].join('\r\n'),
  };
}

export function moveMessage(input: {
  to: string;
  business: string;
  oldLabel: string;
  newLabel: string;
  chargeCents: number;
}): Message {
  return {
    to: input.to,
    subject: `Booking moved: ${input.newLabel}`,
    body: [
      input.business,
      `Moved from ${input.oldLabel}`,
      `Moved to ${input.newLabel}`,
      `New charge: ${formatMoney(input.chargeCents)}`,
    ].join('\r\n'),
  };
}

export function expiryNoticeMessage(input: {
  to: string;
  business: string;
  type: DocumentType;
  expiryDate: string;
  kind: '14' | '3';
}): Message {
  const subject = `${input.kind}-day notice: your ${documentTypeLabel(input.type)} expires on ${input.expiryDate}`;
  return {
    to: input.to,
    subject,
    body: [
      input.business,
      subject,
      'Upload a renewed document so your bookings and check-ins are not refused.',
    ].join('\r\n'),
  };
}

export function inspectorInvitationMessage(input: {
  to: string;
  kitchenName: string;
  url: string;
  expiresLabel: string;
}): Message {
  return {
    to: input.to,
    subject: `Read-only kitchen records: ${input.kitchenName}`,
    body: [
      `Read-only records for ${input.kitchenName}`,
      input.url,
      `Available until ${input.expiresLabel}`,
    ].join('\r\n'),
  };
}

/** The published statement layout: nothing before or after these lines. */
export function statementMessage(input: {
  to: string;
  business: string;
  month: string;
  lines: Array<{ description: string; amountCents: number }>;
  totalCents: number;
}): Message {
  const body = [
    `Statement for ${monthLabel(input.month)}`,
    input.business,
    '',
    ...input.lines.map((line) => `${line.description} ${formatMoney(line.amountCents)}`),
    '',
    `Total ${formatMoney(input.totalCents)}`,
  ].join('\r\n');
  return {
    to: input.to,
    subject: `Statement for ${monthLabel(input.month)}: ${input.business}`,
    body,
  };
}
