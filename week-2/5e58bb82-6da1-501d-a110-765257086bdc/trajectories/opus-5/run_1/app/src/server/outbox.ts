import type { Db } from './db.js';
import { pool } from './db.js';
import { sendMail } from './mail.js';

export interface QueuedEmail {
  dedupeKey: string;
  to: string;
  subject: string;
  body: string;
  alertId?: string | null;
  purpose: string;
}

/**
 * Queues one message per recipient in Postgres. The dedupe key makes the whole
 * pipeline exactly-once across retries and simultaneous requests.
 */
export async function queueEmail(db: Db, email: QueuedEmail): Promise<void> {
  await db.query(
    `INSERT INTO outbox (dedupe_key, to_addr, subject, body, alert_id, purpose)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (dedupe_key) DO NOTHING`,
    [email.dedupeKey, email.to, email.subject, email.body, email.alertId ?? null, email.purpose],
  );
}

/**
 * Sends queued mail, one message at a time, and marks each sent only once the
 * mail server has accepted it. An alert's email state follows its own messages.
 */
export async function flushOutbox(): Promise<void> {
  const queued = await pool.query<{ id: string; to_addr: string; subject: string; body: string }>(
    `SELECT id, to_addr, subject, body FROM outbox WHERE state = 'Queued' ORDER BY id LIMIT 50`,
  );
  for (const row of queued.rows) {
    const claimed = await pool.query(
      `UPDATE outbox SET state = 'Sending' WHERE id = $1 AND state = 'Queued'`,
      [row.id],
    );
    if (claimed.rowCount === 0) continue;
    try {
      await sendMail(row.to_addr, row.subject, row.body);
      await pool.query(`UPDATE outbox SET state = 'Sent', sent_at = now() WHERE id = $1`, [row.id]);
    } catch {
      await pool.query(`UPDATE outbox SET state = 'Queued' WHERE id = $1`, [row.id]);
      break;
    }
  }
  await refreshAlertEmailStates();
}

async function refreshAlertEmailStates(): Promise<void> {
  await pool.query(
    `UPDATE alerts a SET email_state = 'Emailed'
     WHERE a.email_state = 'Queued'
       AND EXISTS (SELECT 1 FROM outbox o WHERE o.alert_id = a.id AND o.purpose = 'alert')
       AND NOT EXISTS (
         SELECT 1 FROM outbox o
         WHERE o.alert_id = a.id AND o.purpose = 'alert' AND o.state <> 'Sent')`,
  );
  await pool.query(
    `UPDATE alerts a SET escalation_state = 'Emailed'
     WHERE a.escalation_state = 'Queued'
       AND EXISTS (SELECT 1 FROM outbox o WHERE o.alert_id = a.id AND o.purpose = 'escalation')
       AND NOT EXISTS (
         SELECT 1 FROM outbox o
         WHERE o.alert_id = a.id AND o.purpose = 'escalation' AND o.state <> 'Sent')`,
  );
}
