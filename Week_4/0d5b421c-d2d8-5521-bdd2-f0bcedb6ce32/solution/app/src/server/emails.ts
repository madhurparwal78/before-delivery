// The four plain-text emails, queued in the same commit as the change they report.
import { formatWhen } from "../shared/calendar.js";
import { formatEuros } from "../shared/euros.js";
import { config } from "./config.js";
import { rows, type Queryable } from "./db.js";
import { lisbonClock } from "./lisbon.js";
import { bookingRoomName, type BookingRow, type OfferRow } from "./records.js";
import type { Message } from "./smtp.js";

function tableLine(row: Pick<BookingRow, "target_id" | "table_ids">): string {
  return `Table ${row.target_id}, ${bookingRoomName(row)}`;
}

function bodyOf(lines: string[]): string {
  return `${lines.join("\n")}\n`;
}

export function confirmationEmail(row: BookingRow, to: string): Message {
  const deposit = row.deposit_state === "paid" ? `Deposit paid: €${formatEuros(row.deposit_cents)}` : "No deposit";
  return {
    to,
    subject: `Booking confirmed: ${row.reference}`,
    body: bodyOf([
      `Hello ${row.name},`,
      "",
      `Your table is booked for ${formatWhen(row.date, row.time)}, Lisbon time.`,
      `Party of ${row.party_size}`,
      tableLine(row),
      `Manage your booking: ${config.publicUrl}/manage/${row.token ?? ""}`,
      deposit,
    ]),
  };
}

export function cancellationEmail(row: BookingRow, to: string): Message {
  const amount = formatEuros(row.deposit_cents);
  let outcome = "No deposit was taken.";
  if (row.deposit_state === "refunded") outcome = `Your deposit of €${amount} has been refunded.`;
  if (row.deposit_state === "retained") outcome = `Your deposit of €${amount} has been kept under our 24-hour policy.`;
  return {
    to,
    subject: `Booking cancelled: ${row.reference}`,
    body: bodyOf([`Hello ${row.name},`, "", `Your booking for ${formatWhen(row.date, row.time)} has been cancelled.`, outcome]),
  };
}

export function offerEmail(offer: OfferRow, to: string): Message {
  const when = formatWhen(offer.date, offer.time);
  return {
    to,
    subject: `A table is free: ${when}`,
    body: bodyOf([
      `A table has come free for ${when}.`,
      "",
      tableLine(offer),
      `Party of ${offer.party_size}`,
      `Claim it here: ${config.publicUrl}/offer/${offer.token}`,
      `This offer ends at ${lisbonClock(offer.expires_at)} Lisbon time.`,
      ...(offer.deposit_cents > 0 ? [`Claiming charges a deposit of €${formatEuros(offer.deposit_cents)}.`] : []),
    ]),
  };
}

export function lapsedEmail(offer: OfferRow, to: string): Message {
  return {
    to,
    subject: "Your table offer has lapsed",
    body: bodyOf([`Your offer for ${formatWhen(offer.date, offer.time)} ended unclaimed.`]),
  };
}

export async function queueEmail(db: Queryable, message: Message): Promise<void> {
  await db.query("INSERT INTO emails (to_address, subject, body) VALUES ($1, $2, $3)", [
    message.to,
    message.subject,
    message.body,
  ]);
}

interface QueuedEmail extends Message {
  id: string;
}

/** The oldest unsent email, locked so that exactly one instance sends it. */
export async function lockNextEmail(db: Queryable): Promise<QueuedEmail | undefined> {
  const [next] = await rows<QueuedEmail>(
    db,
    `SELECT id::text AS id, to_address AS "to", subject, body FROM emails
      WHERE sent_at IS NULL ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`,
  );
  return next;
}

export async function markEmailSent(db: Queryable, id: string): Promise<void> {
  await db.query("UPDATE emails SET sent_at = now() WHERE id = $1", [id]);
}
