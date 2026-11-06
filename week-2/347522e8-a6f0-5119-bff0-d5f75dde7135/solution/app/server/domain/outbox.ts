// The notification outbox: every email is written in the transaction of the action that causes
// it, then delivered once by the sender, which retries while mail is unreachable.

import { randomUUID } from "node:crypto";
import type { NotificationView } from "../../shared/api.js";
import { config } from "../config.js";
import { iso, now } from "../clock.js";
import { type Tx, pool, rows, transaction } from "../db.js";
import { sendMail } from "../services/smtp.js";

type NotificationKind =
  | "receipt"
  | "booking_confirmed"
  | "hold_expired"
  | "booking_displaced"
  | "document_expiring"
  | "document_expired";

interface Notice {
  kind: NotificationKind;
  to: string;
  subject: string;
  body: string;
  /** Notices that must exist once (scan notices, a series' expiry) carry a key. */
  dedupeKey?: string;
}

export async function queueNotice(tx: Tx, notice: Notice): Promise<void> {
  const at = iso(now());
  await tx.query(
    `INSERT INTO notifications (id, kind, recipient, subject, body, status, dedupe_key, created_at)
     VALUES ($1, $2, $3, $4, $5, 'queued', $6, $7) ON CONFLICT (dedupe_key) DO NOTHING`,
    [randomUUID(), notice.kind, notice.to, notice.subject, notice.body, notice.dedupeKey ?? null, at],
  );
}

interface NotificationRow {
  id: string;
  kind: string;
  recipient: string;
  subject: string;
  body: string;
  status: "queued" | "sent";
  attempts: number;
  created_at: Date;
  sent_at: Date | null;
}

/** When this sender last found mail unreachable, it waits OUTBOX_RETRY_SECONDS before trying again. */
let retryAt = 0;

/**
 * Delivers queued notifications one at a time; a row is claimed with SKIP LOCKED so each is sent
 * once. A failed attempt is counted on the row, which stays queued for the next attempt.
 */
export async function deliverDueNotifications(): Promise<void> {
  if (now() < retryAt) return;
  for (let sent = 0; sent < 50; sent += 1) {
    const delivered = await transaction(async (tx) => {
      const [due] = await rows<NotificationRow>(
        tx,
        "SELECT * FROM notifications WHERE status = 'queued' ORDER BY seq LIMIT 1 FOR UPDATE SKIP LOCKED",
      );
      if (!due) return false;
      try {
        await sendMail({ to: due.recipient, subject: due.subject, text: due.body });
        await tx.query("UPDATE notifications SET status = 'sent', attempts = attempts + 1, sent_at = $2 WHERE id = $1", [due.id, iso(now())]);
        return true;
      } catch {
        await tx.query("UPDATE notifications SET attempts = attempts + 1 WHERE id = $1", [due.id]);
        retryAt = now() + config.outboxRetrySeconds * 1000;
        return false;
      }
    });
    if (!delivered) return;
  }
}

export async function listNotifications(): Promise<NotificationView[]> {
  const found = await rows<NotificationRow>(pool, "SELECT * FROM notifications ORDER BY seq DESC LIMIT 500");
  return found.map((row) => ({
    id: row.id,
    kind: row.kind,
    to: row.recipient,
    subject: row.subject,
    status: row.status,
    attempts: row.attempts,
    created_at: iso(row.created_at),
    sent_at: row.sent_at ? iso(row.sent_at) : null,
  }));
}
