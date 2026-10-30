import { now } from '../clock.js';
import { query } from '../db.js';
import { sendMail } from './smtp.js';

const CHECK_INTERVAL_MS = 1500;
const LOCK_SECONDS = 30;

interface DueNotice {
  id: string;
  to_email: string;
  subject: string;
  body: string;
  attempts: number;
}

/** The retry schedule runs on real elapsed time: 5, 10, 20, 40, then every 60 seconds. */
function retryDelayMs(attempts: number): number {
  return Math.min(60, 5 * 2 ** (attempts - 1)) * 1000;
}

async function claimNextNotice(): Promise<DueNotice | undefined> {
  const rows = await query<DueNotice>(
    `UPDATE notices SET locked_until = now() + ($1 || ' seconds')::interval
     WHERE id = (
       SELECT id FROM notices
       WHERE status = 'pending' AND next_attempt_at <= now()
         AND (locked_until IS NULL OR locked_until < now())
       ORDER BY created_at, id
       LIMIT 1 FOR UPDATE SKIP LOCKED
     )
     RETURNING id, to_email, subject, body, attempts`,
    [String(LOCK_SECONDS)],
  );
  return rows[0];
}

async function deliver(notice: DueNotice): Promise<void> {
  const attempts = notice.attempts + 1;
  try {
    await sendMail({ to: notice.to_email, subject: notice.subject, body: notice.body });
    await query(
      `UPDATE notices SET status = 'sent', attempts = $2, sent_at = $3, locked_until = NULL WHERE id = $1`,
      [notice.id, attempts, now()],
    );
  } catch {
    await query(
      `UPDATE notices SET attempts = $2, next_attempt_at = $3, locked_until = NULL WHERE id = $1`,
      [notice.id, attempts, new Date(Date.now() + retryDelayMs(attempts))],
    );
  }
}

let running = false;

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const notice = await claimNextNotice();
      if (!notice) return;
      await deliver(notice);
    }
  } finally {
    running = false;
  }
}

export function startOutboxWorker(): void {
  setInterval(() => {
    void drain().catch(() => undefined);
  }, CHECK_INTERVAL_MS).unref();
}
