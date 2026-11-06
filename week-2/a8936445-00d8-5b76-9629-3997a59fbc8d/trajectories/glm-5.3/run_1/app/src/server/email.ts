/** Every email Stationkeeper sends; one tenant owner per message, only that tenant's records. */

import type { DocumentKind } from "../shared/api-types.js";
import { DOCUMENT_KIND_LABELS } from "../shared/api-types.js";
import type { OutgoingEmail } from "./providers/mail.js";

export const kindLabel = (kind: DocumentKind): string => DOCUMENT_KIND_LABELS[kind];

export interface EmailParts {
  to: string;
  subject: string;
  body: string;
}

export const email = (parts: EmailParts): OutgoingEmail => ({ ...parts });

export interface BookingLineParts {
  ref: string;
  stationName: string;
  date: string;
  startLocal: string;
  endLocal: string;
  payment: string;
}

/** Booking confirmation: subject `Stationkeeper: booking <hold ref> confirmed`. */
export function bookingConfirmationEmail(
  to: string,
  holdRef: string,
  bookings: BookingLineParts[],
  policy: { version: number; free_window_hours: number; late_fee_percent: number }
): OutgoingEmail {
  const lines = [
    `Your booking is confirmed.`,
    ``,
    ...bookings.map(
      (b) => `${b.ref} — ${b.stationName}, ${b.date} ${b.startLocal}–${b.endLocal}, paid with ${b.payment}.`
    ),
    ``,
    `Cancellation: free until ${policy.free_window_hours} hours before start, then ${policy.late_fee_percent}% charge (policy v${policy.version}).`,
    ``,
    `Stationkeeper at Larder Row Kitchen`
  ];
  return email({
    to,
    subject: `Stationkeeper: booking ${holdRef} confirmed`,
    body: lines.join("\n")
  });
}

/** Hold-over notice: subject `Stationkeeper: hold-over recorded on <booking ref>`. */
export function holdoverNoticeEmail(
  to: string,
  bookingRef: string,
  reportedMinutes: number,
  billedMinutes: number,
  amount: string
): OutgoingEmail {
  return email({
    to,
    subject: `Stationkeeper: hold-over recorded on ${bookingRef}`,
    body: [
      `Hold-over was recorded on ${bookingRef}.`,
      ``,
      `Reported: ${reportedMinutes} min past the booked end.`,
      `Billed: ${billedMinutes} min (${amount}).`,
      ``,
      `Stationkeeper at Larder Row Kitchen`
    ].join("\n")
  });
}

/** Expiry reminder: subject `Stationkeeper: <kind label> expires on <YYYY-MM-DD>`. */
export function expiryReminderEmail(to: string, kind: DocumentKind, expiresOn: string): OutgoingEmail {
  return email({
    to,
    subject: `Stationkeeper: ${kindLabel(kind)} expires on ${expiresOn}`,
    body: [
      `Your ${kindLabel(kind).toLowerCase()} expires on ${expiresOn}.`,
      `Upload a renewal from Documents so your business stays active.`,
      ``,
      `Stationkeeper at Larder Row Kitchen`
    ].join("\n")
  });
}

/** Approval: subject `Stationkeeper: <kind label> approved`. */
export function approvalEmail(to: string, kind: DocumentKind, expiresOn: string): OutgoingEmail {
  return email({
    to,
    subject: `Stationkeeper: ${kindLabel(kind)} approved`,
    body: [
      `Your ${kindLabel(kind).toLowerCase()} was approved. It is valid through ${expiresOn}.`,
      ``,
      `Stationkeeper at Larder Row Kitchen`
    ].join("\n")
  });
}

/** Rejection: subject `Stationkeeper: <kind label> needs attention`, with the reason. */
export function rejectionEmail(to: string, kind: DocumentKind, reason: string): OutgoingEmail {
  return email({
    to,
    subject: `Stationkeeper: ${kindLabel(kind)} needs attention`,
    body: [
      `Your ${kindLabel(kind).toLowerCase()} needs attention.`,
      ``,
      `Reason: ${reason}`,
      ``,
      `Upload a corrected document from Documents.`,
      ``,
      `Stationkeeper at Larder Row Kitchen`
    ].join("\n")
  });
}

/** Invoice notice: subject `Stationkeeper: invoice <number> is ready`, with lines and total. */
export function invoiceNoticeEmail(
  to: string,
  number: string,
  period: string,
  lines: Array<{ description: string; amount: string }>,
  subtotal: string,
  tax: string,
  total: string
): OutgoingEmail {
  return email({
    to,
    subject: `Stationkeeper: invoice ${number} is ready`,
    body: [
      `Your invoice ${number} for ${period} is ready.`,
      ``,
      ...lines.map((l) => `${l.description} — ${l.amount}`),
      ``,
      `Subtotal ${subtotal}`,
      `Tax ${tax}`,
      `Total ${total}`,
      ``,
      `You can pay it from Billing.`,
      ``,
      `Stationkeeper at Larder Row Kitchen`
    ].join("\n")
  });
}

/** Receipt: subject `Stationkeeper: receipt for invoice <number>`. */
export function invoiceReceiptEmail(to: string, number: string, total: string): OutgoingEmail {
  return email({
    to,
    subject: `Stationkeeper: receipt for invoice ${number}`,
    body: [
      `Thank you. Invoice ${number} was paid in full (${total}).`,
      ``,
      `Stationkeeper at Larder Row Kitchen`
    ].join("\n")
  });
}

/** Queue an email inside a transaction; the sweep delivers it. */
export async function queueEmail(
  client: { query: (sql: string, params: unknown[]) => Promise<unknown> },
  message: OutgoingEmail
): Promise<void> {
  await client.query(
    "INSERT INTO email_queue (id, to_email, subject, body, created_at) VALUES ($1,$2,$3,$4, now())",
    [crypto.randomUUID(), message.to, message.subject, message.body]
  );
}
