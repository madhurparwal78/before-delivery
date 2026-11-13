import { config } from "./config";
import { pool, one, type Db } from "./db";
import { sendMessage } from "./services/smtp";
import { noteService } from "./services/status";

type MailKind = "invite" | "share" | "role" | "publish";
type Delivery = "sent" | "queued";

interface OutboxRow {
  id: string;
  kind: MailKind;
  recipient: string;
  subject: string;
  body: string;
  ref_id: string | null;
}

/** Writes the message to the outbox; call inside the transaction of the action that causes it. */
export async function enqueueMail(db: Db, kind: MailKind, to: string, subject: string, body: string, refToken: string | null): Promise<number> {
  const row = await one<{ id: string }>(db, "INSERT INTO mail_outbox (kind, recipient, subject, body, ref_id) VALUES ($1,$2,$3,$4,$5) RETURNING id", [kind, to, subject, body, refToken]);
  return Number(row?.id);
}

async function stillLive(row: OutboxRow): Promise<boolean> {
  if (row.kind === "invite") return Boolean(await one(pool, "SELECT 1 FROM invites WHERE token = $1 AND status = 'pending' AND expires_at > $2", [row.ref_id, new Date()]));
  if (row.kind === "share") return Boolean(await one(pool, "SELECT 1 FROM share_links WHERE token = $1 AND revoked_at IS NULL AND expires_at > $2", [row.ref_id, new Date()]));
  return true;
}

async function claim(id: string): Promise<OutboxRow | undefined> {
  return one<OutboxRow>(
    pool,
    `UPDATE mail_outbox SET state = 'sending', claimed_at = now(), attempts = attempts + 1
     WHERE id = $1 AND (state = 'queued' OR (state = 'sending' AND claimed_at < now() - interval '60 seconds'))
     RETURNING id, kind, recipient, subject, body, ref_id`,
    [id],
  );
}

/**
 * Sends the queued messages to one recipient up to `lastId`, in queue order. A message whose invite or link is
 * gone is dropped. Returns whether the message `lastId` itself went out.
 */
async function deliverUpTo(recipient: string, lastId: number): Promise<Delivery> {
  const pending = await pool.query<{ id: string }>(
    "SELECT id FROM mail_outbox WHERE recipient = $1 AND id <= $2 AND (state = 'queued' OR (state = 'sending' AND claimed_at < now() - interval '60 seconds')) ORDER BY id",
    [recipient, lastId],
  );
  let targetSent = false;
  for (const { id } of pending.rows) {
    const row = await claim(id);
    if (!row) return "queued";
    if (!(await stillLive(row))) {
      await pool.query("UPDATE mail_outbox SET state = 'dropped' WHERE id = $1", [id]);
      continue;
    }
    try {
      await sendMessage({ to: row.recipient, subject: row.subject, body: row.body });
    } catch {
      noteService("mail", false);
      await pool.query("UPDATE mail_outbox SET state = 'queued', claimed_at = NULL WHERE id = $1", [id]);
      return "queued";
    }
    noteService("mail", true);
    await pool.query("UPDATE mail_outbox SET state = 'sent', sent_at = now() WHERE id = $1", [id]);
    if (Number(id) === lastId) targetSent = true;
  }
  return targetSent ? "sent" : "queued";
}

/** The attempt made during the request that wrote the message. */
export async function deliverNow(id: number, recipient: string): Promise<Delivery> {
  return deliverUpTo(recipient, id);
}

async function sweepOutbox(): Promise<void> {
  const rows = await pool.query<{ recipient: string; last: string }>(
    "SELECT recipient, max(id) AS last FROM mail_outbox WHERE state = 'queued' OR (state = 'sending' AND claimed_at < now() - interval '60 seconds') GROUP BY recipient",
  );
  for (const row of rows.rows) await deliverUpTo(row.recipient, Number(row.last));
}

export function startMailSweeper(): void {
  setInterval(() => void sweepOutbox().catch(() => undefined), 4000).unref();
}

export const inviteMail = (inviter: string, workspace: string, role: string, token: string, expiresAt: Date): { subject: string; body: string } => ({
  subject: `${inviter} invited you to ${workspace} on Rampwright`,
  body: `${inviter} invited you to join ${workspace} on Rampwright as ${role}.\n\nAccept the invite: ${config.publicUrl}/invite/${token}\n\nThis invite expires at ${expiresAt.toISOString()}.\n`,
});

export const shareMail = (sharer: string, project: string, token: string, expiresAt: Date): { subject: string; body: string } => ({
  subject: `${sharer} shared ${project} with you`,
  body: `${sharer} shared the project ${project} with you on Rampwright.\n\nOpen it, read-only: ${config.publicUrl}/view/${token}\n\nThis link expires at ${expiresAt.toISOString()}.\n`,
});

export const roleMail = (workspace: string, role: string): { subject: string; body: string } => ({
  subject: `Your role in ${workspace} is now ${role}`,
  body: `Your role in ${workspace} on Rampwright is now ${role}.\n`,
});

export const publishMail = (scene: string, address: string, bundleHash: string): { subject: string; body: string } => ({
  subject: `Lab published: ${scene}`,
  body: `Your lab for ${scene} is published.\n\nLab address: ${address}\nBundle hash: ${bundleHash}\n`,
});
