import type { PoolClient } from 'pg';
import { formatDollars } from '../../shared/format';
import type { FeeLine } from '../../shared/types';
import { env } from '../env';
import type { OpeningCalendar } from '../domain/calendar';
import type { LibraryDate } from '../../shared/time';
import { weekdayOf } from '../../shared/time';
import { pool } from '../repo/db';
import { sendMail } from './smtp';

const RETRY_SECONDS = 30;

/**
 * Queues one message inside the caller's transaction, so a message is only
 * sent once the change it reports has been committed, and only once.
 */
export async function queueMail(
  client: PoolClient,
  dedupeKey: string,
  toEmail: string,
  subject: string,
  body: string,
): Promise<void> {
  await client.query(
    `insert into mail_outbox (dedupe_key, to_email, subject, body)
     values ($1, $2, $3, $4) on conflict (dedupe_key) do nothing`,
    [dedupeKey, toEmail, subject, body],
  );
}

interface OutboxRow {
  id: number;
  to_email: string;
  subject: string;
  body: string;
}

async function flushOnce(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const claimed = await client.query<OutboxRow>(
      `select id, to_email, subject, body from mail_outbox
       where sent_at is null and next_attempt_at <= now()
       order by id for update skip locked limit 10`,
    );
    for (const row of claimed.rows) {
      try {
        await sendMail(row.to_email, row.subject, row.body);
        await client.query('update mail_outbox set sent_at = now() where id = $1', [row.id]);
      } catch {
        await client.query(
          `update mail_outbox set next_attempt_at = now() + make_interval(secs => $2) where id = $1`,
          [row.id, RETRY_SECONDS],
        );
      }
    }
    await client.query('commit');
  } catch {
    await client.query('rollback').catch(() => undefined);
  } finally {
    client.release();
  }
}

export function startMailWorker(): void {
  const tick = (): void => {
    void flushOnce().finally(() => setTimeout(tick, 1000));
  };
  tick();
}

export function holdReadyMail(
  itemName: string,
  tag: string,
  hungBackOn: LibraryDate,
  calendar: OpeningCalendar,
  nextOpenDay: LibraryDate,
): { subject: string; body: string } {
  const hours = calendar.hoursFor(weekdayOf(nextOpenDay));
  const hoursLine = hours ? `${hours.opens}–${hours.closes}` : 'the next opening hours';
  return {
    subject: `Your hold is ready: ${itemName} (${tag})`,
    body: [
      `${itemName} (${tag}) is back on the wall and held for you.`,
      `It was hung back on ${hungBackOn}.`,
      `Collect it on ${nextOpenDay}, when the library is open ${hoursLine}.`,
    ].join('\n'),
  };
}

export function feeReceiptMail(
  loanRef: string,
  feeId: number,
  lines: readonly FeeLine[],
  totalCents: number,
  invoiceNumber: string,
): { subject: string; body: string } {
  return {
    subject: `Pegworth fees for loan ${loanRef}: $${formatDollars(totalCents)}`,
    body: [
      `Fees for loan ${loanRef}:`,
      '',
      ...lines.map((line) => `${line.description} — $${formatDollars(line.amount_cents)}`),
      '',
      `Total: $${formatDollars(totalCents)}`,
      `Kill Bill invoice number: ${invoiceNumber}`,
      `See the fee at ${env.publicUrl}/fees/${feeId}`,
    ].join('\n'),
  };
}

export function reminderMail(
  loanRef: string,
  items: readonly { name: string; tag: string }[],
  dueDate: LibraryDate,
  closingTime: string,
): { subject: string; body: string } {
  return {
    subject: `Due tomorrow at Pegworth: ${loanRef}`,
    body: [
      `Loan ${loanRef} is due tomorrow, ${dueDate}, by ${closingTime}.`,
      '',
      ...items.map((item) => `${item.name} (${item.tag})`),
    ].join('\n'),
  };
}
