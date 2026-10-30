import { Pool } from "pg";
import nodemailer, { Transporter } from "nodemailer";
import { Config } from "./config";
import { readCalendar } from "./domain/library";
import { expireReadyHolds } from "./domain/holds";
import { queueEmail } from "./email";
import { formatLocalTime, formatIso } from "./time";
import { closingInstant } from "./calendar";

interface WorkerState {
  pool: Pool;
  config: Config;
  transporter: Transporter;
}

export function startWorkers(pool: Pool, config: Config): void {
  const transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: false,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 5000,
  });
  const state: WorkerState = { pool, config, transporter };

  const tick = async (): Promise<void> => {
    try {
      await runExpiryAndReminders(state);
      await runEmailQueue(state);
    } catch (error) {
      process.stderr.write(`worker tick failed: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  };

  void tick();
  const timer = setInterval(() => {
    void tick();
  }, 3000);
  timer.unref();
}

/** Expiry, lapse emails and due reminders, each exactly once across copies. */
async function runExpiryAndReminders(state: WorkerState): Promise<void> {
  const calendar = await readCalendar(state.pool);
  const zone = calendar.timeZone;
  const client = await state.pool.connect();
  try {
    await client.query("BEGIN");
    const expired = await expireReadyHolds(client);
    for (const hold of expired) {
      queueEmail(client, hold.member_email, {
        kind: "hold_lapsed",
        itemName: hold.item_name,
        unitLabel: hold.unit_label,
        pickupDeadline: formatLocalTime(hold.pickup_deadline, zone),
      });
    }

    const leadMs = state.config.reminderLeadSeconds * 1000;
    const now = Date.now();
    const dueResult = await client.query(
      `SELECT l.id::text AS id, l.due_date::text AS due_date, l.member_id,
              i.name AS item_name, u.label AS unit_label, m.email AS member_email
         FROM loans l
         JOIN items i ON i.id = l.item_id
         JOIN units u ON u.id = l.unit_id
         JOIN users m ON m.id = l.member_id
        WHERE l.status = 'out'`,
    );
    for (const loan of dueResult.rows as {
      id: string; due_date: string; member_id: string; item_name: string; unit_label: string; member_email: string;
    }[]) {
      const dueAt = closingInstant(calendar, loan.due_date);
      const reminderAt = dueAt.getTime() - leadMs;
      if (now < reminderAt || now >= dueAt.getTime()) continue;
      const claimed = await client.query(
        `INSERT INTO due_reminders (loan_id, due_at)
         VALUES ($1, $2)
         ON CONFLICT (loan_id, due_at) DO NOTHING
         RETURNING loan_id::text`,
        [loan.id, dueAt],
      );
      if (claimed.rowCount === 0) continue;
      queueEmail(client, loan.member_email, {
        kind: "due_reminder",
        itemName: loan.item_name,
        unitLabel: loan.unit_label,
        dueAt: formatLocalTime(dueAt, zone),
      });
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function runEmailQueue(state: WorkerState): Promise<void> {
  const client = await state.pool.connect();
  let toSend: { id: string; to_address: string; subject: string; body: string }[] = [];
  try {
    const claimed = await client.query(
      `UPDATE email_outbox
         SET claimed_by = $1, claimed_at = now()
       WHERE id IN (
         SELECT id FROM email_outbox
          WHERE sent_at IS NULL AND (claimed_at IS NULL OR claimed_at < now() - interval '15 seconds')
          ORDER BY created_at ASC
          LIMIT 20
          FOR UPDATE SKIP LOCKED
       )
       RETURNING id::text AS id, to_address, subject, body`,
      [`worker-${process.pid}`],
    );
    toSend = claimed.rows as { id: string; to_address: string; subject: string; body: string }[];
  } finally {
    client.release();
  }
  for (const message of toSend) {
    try {
      await state.transporter.sendMail({
        from: state.config.mailFrom,
        to: message.to_address,
        subject: message.subject,
        text: message.body,
      });
    } catch {
      // Leave the message claimed for its short window; the next tick retries.
      continue;
    }
    await state.pool.query("UPDATE email_outbox SET sent_at = now() WHERE id = $1", [message.id]);
  }
}
