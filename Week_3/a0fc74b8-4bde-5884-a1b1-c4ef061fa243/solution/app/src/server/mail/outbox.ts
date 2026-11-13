import { config } from "../config.js";
import { type Db, pool, tx } from "../db.js";
import { appendAudit } from "../domain/audit.js";
import { type DocumentRow, type RecipientRow, type UserRow, touchDocument } from "../domain/rows.js";
import { reportFailure } from "../health.js";
import { newId, sha256Hex } from "../util.js";
import { composeMail, type MailFacts, type MailKind } from "./messages.js";
import { sendMail } from "./smtp.js";

type OutboxKind = "invitation" | "new_link" | "decline_notice" | "void_notice" | "completed";

interface OutboxRow {
  id: string;
  kind: OutboxKind;
  document_id: string;
  recipient_id: string | null;
  to_email: string;
  link_token: string | null;
}

const FIRST_ATTEMPT_GRACE_SECONDS = 10;
const BATCH = 20;

interface QueuedMail {
  kind: OutboxKind;
  documentId: string;
  recipientId: string | null;
  toEmail: string;
  linkToken: string | null;
}

export async function queueMail(db: Db, mail: QueuedMail): Promise<string> {
  const id = newId();
  await db.query(
    `INSERT INTO outbox (id, kind, document_id, recipient_id, to_email, link_token, next_attempt_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(secs => $7))`,
    [id, mail.kind, mail.documentId, mail.recipientId, mail.toEmail, mail.linkToken, FIRST_ATTEMPT_GRACE_SECONDS],
  );
  return id;
}

async function factsFor(row: OutboxRow): Promise<MailFacts> {
  const { rows: documents } = await pool.query<DocumentRow>("SELECT * FROM documents WHERE id = $1", [row.document_id]);
  const document = documents[0];
  if (!document) throw new Error("document for queued mail is gone");
  const { rows: owners } = await pool.query<UserRow>("SELECT * FROM users WHERE id = $1", [document.owner_id]);
  const { rows: decliners } = await pool.query<RecipientRow>("SELECT * FROM recipients WHERE document_id = $1 AND status = 'declined'", [document.id]);
  const { rows: voiders } = await pool.query<UserRow>("SELECT * FROM users WHERE id = $1", [document.voided_by]);
  const kind: MailKind = row.kind;
  const base = {
    kind,
    toEmail: row.to_email,
    title: document.title,
    senderName: owners[0]?.name ?? "",
    linkToken: row.link_token,
    reason: null,
    actorName: null,
    completedSha256: document.completed_sha256,
    downloadPath: null,
  };
  if (row.kind === "decline_notice") return { ...base, reason: decliners[0]?.decline_reason ?? "", actorName: decliners[0]?.name ?? "" };
  if (row.kind === "void_notice") return { ...base, reason: document.void_reason ?? "", actorName: voiders[0]?.name ?? "" };
  if (row.kind === "completed") {
    return { ...base, downloadPath: row.link_token ? `/sign/${row.link_token}/completed.pdf` : `/api/documents/${document.id}/completed.pdf` };
  }
  return base;
}

async function recordInvitationOutcome(row: OutboxRow, delivered: boolean): Promise<void> {
  if ((row.kind !== "invitation" && row.kind !== "new_link") || !row.recipient_id || !row.link_token) return;
  const recipientId = row.recipient_id;
  const hash = sha256Hex(row.link_token);
  await tx(async (client) => {
    const { rows: documents } = await client.query<DocumentRow>("SELECT * FROM documents WHERE id = $1 FOR UPDATE", [row.document_id]);
    const document = documents[0];
    const { rows: recipients } = await client.query<RecipientRow>("SELECT * FROM recipients WHERE id = $1", [recipientId]);
    const recipient = recipients[0];
    const { rows: links } = await client.query<{ replaced: boolean }>("SELECT replaced FROM links WHERE token_hash = $1", [hash]);
    if (!document || !recipient || document.status !== "in_progress" || links[0]?.replaced !== false) return;
    if (delivered && recipient.delivery !== "sent") {
      await client.query("UPDATE recipients SET delivery = 'sent' WHERE id = $1", [recipient.id]);
      await appendAudit(client, document.id, "invite.sent", "system", recipient.id);
    } else if (!delivered && recipient.delivery !== "held" && recipient.delivery !== "sent") {
      await client.query("UPDATE recipients SET delivery = 'held' WHERE id = $1", [recipient.id]);
      await appendAudit(client, document.id, "invite.held", "system", recipient.id);
    } else return;
    await touchDocument(client, document);
  });
}

async function deliverMail(id: string, onlyWhenDue: boolean): Promise<boolean | null> {
  const { rows } = await pool.query<OutboxRow>(
    `UPDATE outbox SET next_attempt_at = now() + make_interval(secs => $2)
     WHERE id = $1 AND status = 'held' ${onlyWhenDue ? "AND next_attempt_at <= now()" : ""}
     RETURNING id, kind, document_id, recipient_id, to_email, link_token`,
    [id, config.mailRetrySeconds],
  );
  const row = rows[0];
  if (!row) return null;
  let delivered = true;
  try {
    await sendMail(composeMail(await factsFor(row)));
  } catch {
    delivered = false;
    reportFailure("mail");
  }
  if (delivered) await pool.query("UPDATE outbox SET status = 'sent', link_token = NULL WHERE id = $1", [row.id]);
  await recordInvitationOutcome(row, delivered);
  return delivered;
}

export async function deliverAll(ids: string[]): Promise<void> {
  for (const id of ids) await deliverMail(id, false);
}

export async function retryHeldMail(): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    "SELECT id FROM outbox WHERE status = 'held' AND next_attempt_at <= now() ORDER BY next_attempt_at LIMIT $1",
    [BATCH],
  );
  for (const { id } of rows) {
    if ((await deliverMail(id, true)) === false) return;
  }
}
