import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { now } from './clock.js';
import { db, withTransaction, type Queryable } from './db.js';
import { sendMail } from './mail.js';
import { isoZoned } from './domain/time.js';
import { publishToMembers, publishToRide } from './live.js';

export type OutboxKind =
  | 'sign_in_code'
  | 'booking_confirmed'
  | 'request_accepted'
  | 'request_declined'
  | 'request_expired'
  | 'time_change'
  | 'cancellation'
  | 'ratings_revealed'
  | 'id_review';

export interface QueueInput {
  kind: OutboxKind;
  to: string;
  subject: string;
  body: string;
  rideId?: string | null;
  passengerId?: string | null;
  memberId?: string | null;
  bookingId?: string | null;
}

/** Every email is a row written in the same transaction as the change that caused it. */
export async function queueEmail(tx: Queryable, input: QueueInput): Promise<string> {
  const id = randomUUID();
  await tx.query(
    `insert into outbox (id, kind, to_email, subject, body, status, attempts, created_at, ride_id, passenger_id, member_id, booking_id)
     values ($1, $2, $3, $4, $5, 'queued', 0, $6, $7, $8, $9, $10)`,
    [
      id,
      input.kind,
      input.to,
      input.subject,
      input.body,
      now(),
      input.rideId ?? null,
      input.passengerId ?? null,
      input.memberId ?? null,
      input.bookingId ?? null,
    ],
  );
  return id;
}

interface OutboxRow {
  id: string;
  kind: OutboxKind;
  to_email: string;
  subject: string;
  body: string;
  attempts: number;
  ride_id: string | null;
  passenger_id: string | null;
}

/**
 * Claim one queued row with a row lock, send it, and mark it sent only once the transport
 * accepts it. Several instances may share the database and each row still goes once.
 */
async function sendClaimed(id: string): Promise<OutboxRow | null> {
  const sent = await withTransaction(async (tx) => {
    const { rows } = await tx.query<OutboxRow>(
      `select id, kind, to_email, subject, body, attempts, ride_id, passenger_id
         from outbox where id = $1 and status = 'queued' for update skip locked`,
      [id],
    );
    const row = rows[0];
    if (!row) return null;
    try {
      await sendMail({ to: row.to_email, subject: row.subject, body: row.body, date: now() });
    } catch {
      await tx.query(
        'update outbox set attempts = attempts + 1, last_attempt_at = $2 where id = $1',
        [row.id, now()],
      );
      return null;
    }
    const sentAt = now();
    await tx.query(
      `update outbox set status = 'sent', attempts = attempts + 1, last_attempt_at = $2, sent_at = $2
        where id = $1`,
      [row.id, sentAt],
    );
    return { row, sentAt };
  });
  if (!sent) return null;
  await announceNotice(sent.row, sent.sentAt);
  return sent.row;
}

async function announceNotice(row: OutboxRow, sentAt: Date): Promise<void> {
  if (!row.ride_id || !row.passenger_id) return;
  if (row.kind !== 'time_change' && row.kind !== 'cancellation') return;
  const notice = {
    ride_id: row.ride_id,
    passenger_id: row.passenger_id,
    kind: row.kind,
    status: 'sent',
    sent_at: isoZoned(sentAt),
  };
  publishToRide(row.ride_id, 'notice', notice);
  const { rows } = await db.query<{ driver_id: string }>(
    'select driver_id from rides where id = $1',
    [row.ride_id],
  );
  const driverId = rows[0]?.driver_id;
  if (driverId) publishToMembers([driverId], 'notice', notice);
}

async function queuedIds(limit: number): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `select id from outbox where status = 'queued' order by seq limit $1`,
    [limit],
  );
  return rows.map((row) => row.id);
}

/** Try every queued row once. */
export async function drainOutbox(): Promise<void> {
  for (const id of await queuedIds(50)) {
    await sendClaimed(id);
  }
}

/**
 * After a save commits, try its own rows once within a short budget so the answer can
 * report each row's status.
 */
export async function flushRows(ids: readonly string[], budgetMs = 2000): Promise<void> {
  const deadline = Date.now() + budgetMs;
  for (const id of ids) {
    if (Date.now() >= deadline) return;
    await sendClaimed(id);
  }
}

export const mailCopy = {
  signInCode: (code: string) => ({
    subject: 'Your Longseat sign-in code',
    body: `Your code is ${code}. It expires in ${
      config.limits.emailCodeTtlSeconds / 60
    } minutes.`,
  }),
  bookingConfirmed: (from: string, to: string, date: string, price: string) => ({
    subject: `Seat booked: ${from} to ${to}, ${date}`,
    body: `${price} was paid from your Longseat wallet.`,
  }),
  requestAccepted: (driver: string, from: string, to: string, date: string) => ({
    subject: 'Your request was accepted',
    body: `${driver} accepted your request: ${from} to ${to}, ${date}.`,
  }),
  requestDeclined: (price: string) => ({
    subject: 'Your request was declined',
    body: `${price} is back in your Longseat wallet.`,
  }),
  requestExpired: (price: string) => ({
    subject: 'Your request expired',
    body: `${price} is back in your Longseat wallet.`,
  }),
  timeChange: (
    date: string,
    newTime: string,
    driver: string,
    oldTime: string,
    freeCancel: { time: string; date: string } | null,
  ) => ({
    subject: `Your Longseat ride on ${date} now leaves at ${newTime}`,
    body: `${driver} moved the departure from ${oldTime} to ${newTime}.${
      freeCancel
        ? `\nYou can cancel for free until ${freeCancel.time} on ${freeCancel.date}.`
        : ''
    }`,
  }),
  rideCancelled: (date: string, price: string) => ({
    subject: `Your Longseat ride on ${date} was cancelled`,
    body: `${price} has been refunded to your Longseat wallet.`,
  }),
  ratingsRevealed: (from: string, to: string, date: string) => ({
    subject: 'Your Longseat ratings are in',
    body: `Ratings are revealed for ${from} to ${to}, ${date}.`,
  }),
  idReview: (verified: boolean, reason: string | null) => ({
    subject: 'Your Longseat ID review',
    body: verified ? 'Your ID is verified.' : `Please upload your ID again: ${reason}.`,
  }),
};
