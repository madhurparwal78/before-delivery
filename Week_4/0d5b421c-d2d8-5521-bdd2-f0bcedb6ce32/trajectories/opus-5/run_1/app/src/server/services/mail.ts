import { config } from '../config';
import { query, withTransaction, type Db } from '../db';
import { euros } from '../domain/rules';
import { formatWhen, lisbonParts } from '../time';
import { sendMail } from './smtp';

interface QueuedEmail {
  dedupeKey: string;
  to: string;
  subject: string;
  body: string;
}

async function queue(db: Db, email: QueuedEmail): Promise<void> {
  await query(
    db,
    `insert into outbound_emails(dedupe_key, to_email, subject, body)
     values ($1, $2, $3, $4) on conflict (dedupe_key) do nothing`,
    [email.dedupeKey, email.to, email.subject, email.body],
  );
}

export interface ConfirmationMail {
  to: string;
  reference: string;
  startsAt: Date;
  partySize: number;
  tableLabel: string;
  room: string;
  manageToken: string;
  depositCents: number;
}

export async function queueConfirmationEmail(db: Db, mail: ConfirmationMail): Promise<void> {
  const lines = [
    `Your table is booked for ${formatWhen(mail.startsAt)}, Lisbon time.`,
    `Party of ${mail.partySize}`,
    `Table ${mail.tableLabel}, ${mail.room}`,
    `Manage your booking: ${config.publicUrl}/manage/${mail.manageToken}`,
    mail.depositCents > 0 ? `Deposit paid: €${euros(mail.depositCents)}` : 'No deposit',
  ];
  await queue(db, {
    dedupeKey: `confirmation:${mail.reference}`,
    to: mail.to,
    subject: `Booking confirmed: ${mail.reference}`,
    body: `${lines.join('\n')}\n`,
  });
}

export type CancellationOutcome = 'refunded' | 'retained' | 'none';

export interface CancellationMail {
  to: string;
  reference: string;
  startsAt: Date;
  depositCents: number;
  outcome: CancellationOutcome;
}

export async function queueCancellationEmail(db: Db, mail: CancellationMail): Promise<void> {
  const depositLine =
    mail.outcome === 'refunded'
      ? `Your deposit of €${euros(mail.depositCents)} has been refunded.`
      : mail.outcome === 'retained'
        ? `Your deposit of €${euros(mail.depositCents)} has been kept under our 24-hour policy.`
        : 'No deposit was taken.';
  const lines = [`Your booking for ${formatWhen(mail.startsAt)} has been cancelled.`, depositLine];
  await queue(db, {
    dedupeKey: `cancellation:${mail.reference}`,
    to: mail.to,
    subject: `Booking cancelled: ${mail.reference}`,
    body: `${lines.join('\n')}\n`,
  });
}

export interface OfferMail {
  to: string;
  offerId: string;
  startsAt: Date;
  expiresAt: Date;
  partySize: number;
  tableLabel: string;
  room: string;
  token: string;
  depositCents: number;
}

export async function queueOfferEmail(db: Db, mail: OfferMail): Promise<void> {
  const lines = [
    `Table ${mail.tableLabel}, ${mail.room}`,
    `Party of ${mail.partySize}`,
    `Claim it here: ${config.publicUrl}/offer/${mail.token}`,
    `This offer ends at ${lisbonParts(mail.expiresAt).timeWithSeconds} Lisbon time.`,
  ];
  if (mail.depositCents > 0) {
    lines.push(`Claiming charges a deposit of €${euros(mail.depositCents)}.`);
  }
  await queue(db, {
    dedupeKey: `offer:${mail.offerId}`,
    to: mail.to,
    subject: `A table is free: ${formatWhen(mail.startsAt)}`,
    body: `${lines.join('\n')}\n`,
  });
}

export async function queueLapsedEmail(
  db: Db,
  mail: { to: string; offerId: string; startsAt: Date },
): Promise<void> {
  await queue(db, {
    dedupeKey: `lapsed:${mail.offerId}`,
    to: mail.to,
    subject: 'Your table offer has lapsed',
    body: `Your offer for ${formatWhen(mail.startsAt)} ended unclaimed.\n`,
  });
}

interface EmailRow {
  id: string;
  to_email: string;
  subject: string;
  body: string;
}

/** Sends each queued email exactly once, retrying until the SMTP server accepts it. */
export async function deliverQueuedEmails(): Promise<void> {
  for (;;) {
    const delivered = await withTransaction(async (client) => {
      const claimed = await query<EmailRow>(
        client,
        `select id, to_email, subject, body from outbound_emails
         where status = 'queued' and next_attempt_at <= now()
         order by id for update skip locked limit 1`,
      );
      const row = claimed.rows[0];
      if (!row) return false;
      try {
        await sendMail({
          to: row.to_email,
          subject: row.subject,
          body: row.body,
        });
        await query(
          client,
          `update outbound_emails set status = 'sent', sent_at = now(), attempts = attempts + 1
           where id = $1`,
          [row.id],
        );
      } catch {
        await query(
          client,
          `update outbound_emails
           set attempts = attempts + 1, next_attempt_at = now() + interval '2 seconds'
           where id = $1`,
          [row.id],
        );
      }
      return true;
    });
    if (!delivered) return;
  }
}
