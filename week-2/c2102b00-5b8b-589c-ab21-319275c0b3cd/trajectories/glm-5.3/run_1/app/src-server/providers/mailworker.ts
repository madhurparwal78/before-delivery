import { all, config, tx, run } from "../db";
import { smtpSend } from "./smtp";

const SENDING_LEASE_SEC = 30;

let running = false;

/** Claims one queued message owned by this process's mail endpoint. */
function claimNext(): number | null {
  const nowSec = Math.floor(Date.now() / 1000);
  return tx(() => {
    const rows = all<{ id: number }>(
      `SELECT id FROM emails WHERE status = 'queued' AND endpoint = ?
       AND (sending_until IS NULL OR sending_until < ?)
       ORDER BY id LIMIT 1`,
      config.mailEndpoint, nowSec
    );
    if (rows.length === 0) return null;
    const claimed = run(
      `UPDATE emails SET sending_until = ? WHERE id = ? AND status = 'queued'
       AND (sending_until IS NULL OR sending_until < ?)`,
      nowSec + SENDING_LEASE_SEC, rows[0].id, nowSec
    );
    return claimed.changes > 0 ? rows[0].id : null;
  });
}

function getEmail(id: number): { to_email: string; subject: string; body: string; message_id: string } | null {
  const rows = all<{ to_email: string; subject: string; body: string; message_id: string }>(
    "SELECT to_email, subject, body, message_id FROM emails WHERE id = ?",
    id
  );
  return rows[0] ?? null;
}

async function deliverOne(id: number): Promise<void> {
  const email = getEmail(id);
  if (!email) return;
  try {
    await smtpSend({
      toEmail: email.to_email,
      subject: email.subject,
      body: email.body,
      messageId: email.message_id,
    });
    tx(() => {
      run("UPDATE emails SET status = 'sent', sent_at = ? WHERE id = ? AND status = 'queued'", Math.floor(Date.now() / 1000), id);
    });
  } catch {
    tx(() => {
      run("UPDATE emails SET failed_attempts = failed_attempts + 1, sending_until = NULL WHERE id = ? AND status = 'queued'", id);
    });
  }
}

/** Delivers every queued message this process owns, one at a time. */
export function deliverSoon(): void {
  if (running) return;
  running = true;
  void (async () => {
    try {
      for (;;) {
        const id = claimNext();
        if (id === null) return;
        await deliverOne(id);
      }
    } finally {
      running = false;
    }
  })();
}

let workerStarted = false;

export function startMailWorker(): void {
  if (workerStarted) return;
  workerStarted = true;
  setInterval(() => {
    deliverSoon();
  }, config.mailRetrySeconds * 1000);
}
