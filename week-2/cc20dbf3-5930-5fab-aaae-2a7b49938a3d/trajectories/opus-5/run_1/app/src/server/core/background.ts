import { inTransaction } from '../db/pool.js';
import { sendMail } from '../services/smtp.js';
import type { AppContext } from './context.js';
import { dueReminderMessage, lapseMessage, queueMessage } from './mailer.js';

const TICK_MS = 2_000;
const EMAIL_BATCH = 10;
const RETRY_BACKOFF_SECONDS = 5;

interface LapsedHoldRow {
  id: string;
  item_name: string;
  unit_label: string;
  pickup_deadline: Date;
  email: string;
}

interface ReminderRow {
  id: string;
  item_name: string;
  unit_label: string;
  due_at: Date;
  email: string;
}

interface PendingMessageRow {
  id: string;
  to_address: string;
  subject: string;
  body: string;
}

/**
 * Expiry, reminders and email delivery run independently of requests, and stay
 * correct when several copies of the server share the database.
 */
export class BackgroundWork {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly app: AppContext) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    void this.tick();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.expireHolds();
      await this.queueDueReminders();
      await this.deliverMail();
    } catch {
      /* every step is retried on the next tick */
    } finally {
      this.running = false;
    }
  }

  /** A ready hold past its pickup deadline expires, frees its unit and lapses once. */
  private async expireHolds(): Promise<void> {
    await inTransaction(this.app.pool, async (client) => {
      const lapsed = await client.query<{ id: string }>(
        `update hold set status = 'expired', lapse_queued = true
         where id in (
           select h.id from hold h
           where h.status = 'ready' and h.pickup_deadline <= now() and not h.lapse_queued
           for update skip locked
         )
         returning id`,
      );
      if (lapsed.rows.length === 0) return;
      const details = await client.query<LapsedHoldRow>(
        `select h.id, i.name as item_name, u.label as unit_label, h.pickup_deadline, p.email
         from hold h
         join item i on i.id = h.item_id
         join unit u on u.id = h.unit_id
         join person p on p.id = h.member_id
         where h.id = any($1::uuid[])`,
        [lapsed.rows.map((row) => row.id)],
      );
      for (const row of details.rows) {
        await queueMessage(
          client,
          lapseMessage(this.app.library.calendar, {
            holdId: row.id,
            itemName: row.item_name,
            unitLabel: row.unit_label,
            pickupDeadline: row.pickup_deadline,
            memberEmail: row.email,
          }),
        );
      }
    });
  }

  /** One due reminder per loan and per due instant, once the lead time is reached. */
  private async queueDueReminders(): Promise<void> {
    await inTransaction(this.app.pool, async (client) => {
      const due = await client.query<ReminderRow>(
        `select l.id, i.name as item_name, u.label as unit_label, l.due_at, p.email
         from loan l
         join item i on i.id = l.item_id
         join unit u on u.id = l.unit_id
         join person p on p.id = l.member_id
         where l.status = 'out'
           and l.due_at > now()
           and l.due_at - make_interval(secs => $1::double precision) <= now()`,
        [this.app.config.reminderLeadSeconds],
      );
      for (const row of due.rows) {
        await queueMessage(
          client,
          dueReminderMessage(this.app.library.calendar, {
            loanId: row.id,
            itemName: row.item_name,
            unitLabel: row.unit_label,
            dueAt: row.due_at,
            memberEmail: row.email,
          }),
        );
      }
    });
  }

  /** Each queued message is claimed by one copy and sent exactly once. */
  private async deliverMail(): Promise<void> {
    for (;;) {
      const claimed = await inTransaction(this.app.pool, async (client) => {
        const pending = await client.query<PendingMessageRow>(
          `select id, to_address, subject, body from email_message
           where sent_at is null and next_attempt_at <= now()
           order by created_at asc
           limit $1
           for update skip locked`,
          [EMAIL_BATCH],
        );
        if (pending.rows.length === 0) return [];
        await client.query(
          `update email_message
           set attempts = attempts + 1,
               next_attempt_at = now() + make_interval(secs => $2::double precision)
           where id = any($1::uuid[])`,
          [pending.rows.map((row) => row.id), RETRY_BACKOFF_SECONDS],
        );
        return pending.rows;
      });
      if (claimed.length === 0) return;
      for (const message of claimed) {
        try {
          await sendMail(this.app.config.smtp.host, this.app.config.smtp.port, this.app.config.smtp.from, {
            to: message.to_address,
            subject: message.subject,
            body: message.body,
          });
          await this.app.pool.query(`update email_message set sent_at = now() where id = $1`, [
            message.id,
          ]);
        } catch {
          /* the message stays queued and is retried after the backoff */
        }
      }
      if (claimed.length < EMAIL_BATCH) return;
    }
  }
}
