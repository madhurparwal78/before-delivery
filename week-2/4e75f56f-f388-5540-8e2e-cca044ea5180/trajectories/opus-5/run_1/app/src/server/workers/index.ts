import { pool, withLedgerLock, withWorkClaim } from '../db/pool.js';
import { sweepLedger } from '../domain/holds.js';
import { queueBalanceReminder } from '../domain/notifications.js';
import { finishPayment, pendingPaymentIds } from '../domain/payments.js';
import { REMINDER_21_DATE, REMINDER_7_DATE, RESERVE_BY_DATE, venueDate } from '../domain/venue.js';
import { sendMail } from '../services/mailer.js';

const SWEEP_INTERVAL_MS = 1_000;
const MAIL_INTERVAL_MS = 2_000;
const RECEIPT_INTERVAL_MS = 2_000;
const REMINDER_INTERVAL_MS = 10_000;

interface QueuedMail {
  id: string;
  to_email: string;
  subject: string;
  body: string;
}

/** Claims a batch of queued mail so no other process sends the same message. */
async function sendQueuedMail(): Promise<void> {
  await pool.query(
    `update mail_queue set state = 'queued'
     where state = 'sending' and created_at < now() - interval '60 seconds'`,
  );
  const claimed = await pool.query<QueuedMail>(
    `update mail_queue set state = 'sending', attempts = attempts + 1
     where id in (
       select id from mail_queue where state = 'queued'
       order by created_at limit 20 for update skip locked
     )
     returning id, to_email, subject, body`,
  );
  for (const mail of claimed.rows) {
    try {
      await sendMail(mail.to_email, mail.subject, mail.body);
      await pool.query(`update mail_queue set state = 'sent', sent_at = now() where id = $1`, [
        mail.id,
      ]);
    } catch {
      await pool.query(`update mail_queue set state = 'queued' where id = $1`, [mail.id]);
    }
  }
}

async function retryPendingReceipts(): Promise<void> {
  const ids = await pendingPaymentIds();
  for (const id of ids) {
    await finishPayment(id).catch(() => undefined);
  }
}

async function sendBalanceReminders(): Promise<void> {
  const today = venueDate();
  if (today > RESERVE_BY_DATE) return;
  const kind: '21' | '7' | null =
    today >= REMINDER_7_DATE ? '7' : today >= REMINDER_21_DATE ? '21' : null;
  if (kind === null) return;

  const due = await pool.query<{
    id: string;
    bench: string;
    buyer_email: string;
    balance_cents: number;
  }>(
    `select r.id, r.bench, a.email as buyer_email,
       (r.price_cents - coalesce((select sum(pi.amount_cents) from payment_items pi
          where pi.reservation_id = r.id), 0))::int as balance_cents
     from reservations r join accounts a on a.id = r.buyer_id
     where r.state = 'deposit_paid'
       and not exists (select 1 from balance_reminders br
                       where br.reservation_id = r.id and br.kind = $1)`,
    [kind],
  );

  for (const seat of due.rows) {
    const claimed = await pool.query<{ reservation_id: string }>(
      `insert into balance_reminders (reservation_id, kind) values ($1, $2)
       on conflict (reservation_id, kind) do nothing
       returning reservation_id`,
      [seat.id, kind],
    );
    if (claimed.rows.length === 0) continue;
    if (kind === '7') {
      await pool.query(
        `insert into balance_reminders (reservation_id, kind) values ($1, '21')
         on conflict (reservation_id, kind) do nothing`,
        [seat.id],
      );
    }
    await queueBalanceReminder(
      pool,
      seat.id,
      kind,
      seat.buyer_email,
      seat.bench,
      seat.balance_cents,
    );
  }
}

function loop(name: string, intervalMs: number, work: () => Promise<void>): void {
  const run = async (): Promise<void> => {
    try {
      await work();
    } catch (error) {
      process.stderr.write(
        `worker ${name} failed: ${error instanceof Error ? error.message : 'unknown'}\n`,
      );
    } finally {
      setTimeout(run, intervalMs).unref();
    }
  };
  setTimeout(run, intervalMs).unref();
}

export function startWorkers(): void {
  loop('sweep', SWEEP_INTERVAL_MS, async () => {
    await withLedgerLock(sweepLedger);
  });
  loop('mail', MAIL_INTERVAL_MS, sendQueuedMail);
  loop('receipts', RECEIPT_INTERVAL_MS, async () => {
    await withWorkClaim('receipts', retryPendingReceipts);
  });
  loop('reminders', REMINDER_INTERVAL_MS, sendBalanceReminders);
}
