// The mail outbox: every email is a row first; one sender per process claims rows with
// SKIP LOCKED so each is delivered exactly once across app copies sharing the database.
import { config } from "./config.js";
import { one, query, tx, type Db } from "./db.js";
import { emit } from "./events.js";
import { inviteStatus, type InviteStatus } from "./expiry.js";
import { sendMail } from "./smtp.js";
import { nowMs } from "./time.js";

interface QueuedMail {
  workspaceId: string;
  kind: "invite" | "mention" | "digest";
  recipientId: string | null;
  email: string;
  inviteId?: string;
  messageId?: number;
  subject: string;
  body: string;
}

export async function ownerOf(db: Db, workspaceId: string): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>("SELECT id FROM people WHERE workspace_id = $1 AND role = 'owner'", [workspaceId]);
  return rows.map((r) => r.id);
}

/** Tells the owner's pages that the held count changed. */
async function heldChanged(db: Db, workspaceId: string): Promise<void> {
  await emit(db, workspaceId, "notice", {}, { recipients: await ownerOf(db, workspaceId) });
}

export async function queueMail(db: Db, mail: QueuedMail): Promise<void> {
  await db.query(
    "INSERT INTO outbox (workspace_id, kind, recipient_id, recipient_email, invite_id, message_id, subject, body, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [mail.workspaceId, mail.kind, mail.recipientId, mail.email, mail.inviteId ?? null, mail.messageId ?? null, mail.subject, mail.body, nowMs()],
  );
  await heldChanged(db, mail.workspaceId);
}

type MootRecord = { messageIds: number[] } | { inviteId: string } | { personId: string } | { personId: string; channelId: string };

/** Removes held mail made moot by a change, in that change's transaction. */
export async function dropHeldMail(db: Db, workspaceId: string, record: MootRecord): Promise<void> {
  const [condition, ...values] =
    "messageIds" in record
      ? ["message_id = ANY($2)", record.messageIds]
      : "inviteId" in record
        ? ["invite_id = $2", record.inviteId]
        : "channelId" in record
          ? ["recipient_id = $2 AND message_id IN (SELECT id FROM messages WHERE channel_id = $3)", record.personId, record.channelId]
          : ["(recipient_id = $2 OR lower(recipient_email) = (SELECT email_key FROM people WHERE id = $2))", record.personId];
  const { rowCount } = await db.query(`DELETE FROM outbox WHERE workspace_id = $1 AND sent_at IS NULL AND ${condition}`, [workspaceId, ...values]);
  if (rowCount) await heldChanged(db, workspaceId);
}

/** Unsent mail of one workspace, or of the whole database for a caller with none. */
export async function heldCount(workspaceId: string | null): Promise<number> {
  return (await one<{ n: number }>("SELECT count(*)::int AS n FROM outbox WHERE ($1::uuid IS NULL OR workspace_id = $1) AND sent_at IS NULL", [workspaceId]))?.n ?? 0;
}

let lastAttemptFailed = false;

export function lastDeliveryFailed(): boolean {
  return lastAttemptFailed;
}

interface OutboxRow {
  id: number;
  workspace_id: string;
  recipient_email: string;
  subject: string;
  body: string;
  invite_id: string | null;
  invite_status: InviteStatus | null;
  invite_expires_at: number | null;
}

/** Delivers one held message; false when nothing was due. Throws when SMTP refuses. */
async function deliverOne(): Promise<boolean> {
  return tx(async (db) => {
    const { rows } = await db.query<OutboxRow>(
      `SELECT o.id, o.workspace_id, o.recipient_email, o.subject, o.body, o.invite_id, i.status AS invite_status, i.expires_at AS invite_expires_at
       FROM outbox o LEFT JOIN invites i ON i.id = o.invite_id
       WHERE o.sent_at IS NULL ORDER BY o.id LIMIT 1 FOR UPDATE OF o SKIP LOCKED`,
    );
    const row = rows[0];
    if (!row) return false;
    if (row.invite_id && (row.invite_status === null || inviteStatus(row.invite_status, row.invite_expires_at ?? 0, nowMs()) !== "pending")) {
      await db.query("DELETE FROM outbox WHERE id = $1", [row.id]);
      await heldChanged(db, row.workspace_id);
      return true;
    }
    await sendMail({ to: row.recipient_email, subject: row.subject, body: row.body, workspaceId: row.workspace_id });
    await db.query("UPDATE outbox SET sent_at = $2 WHERE id = $1", [row.id, nowMs()]);
    await heldChanged(db, row.workspace_id);
    return true;
  });
}

/** The sender loop: drains the outbox, and after an SMTP failure waits OUTBOX_RETRY_SECONDS. */
export function startSender(): void {
  const run = async (): Promise<void> => {
    let delay = 1000;
    try {
      while (await deliverOne());
      lastAttemptFailed = false;
    } catch {
      const held = await query("SELECT 1 FROM outbox WHERE sent_at IS NULL LIMIT 1").catch(() => []);
      lastAttemptFailed = held.length > 0;
      delay = config.timers.outboxRetry * 1000;
    }
    setTimeout(() => void run(), delay);
  };
  void run();
}
