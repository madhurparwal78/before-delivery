// Care messages and their attachments. A photo's original stays byte for byte; staff see the cleaned copy.

import { randomUUID } from "node:crypto";
import type { MessageView, ThreadView } from "../shared/api";
import { wholeSeconds } from "../shared/time";
import { inTransaction, one, pool, rows } from "./db";
import { attachmentStore503, invalid } from "./errors";
import type { Multipart } from "./http";
import { cleanJpeg, cleanPng } from "./photos";
import { countMessage } from "./rate";
import { getObject, putObject, StoreUnavailable } from "./store";

const BODY_LIMIT = 2000;

type AttachmentKind = "pdf" | "jpeg" | "png";

function kindOf(file: Buffer): AttachmentKind | null {
  if (file.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (file.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "jpeg";
  if (file.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  return null;
}

const ATTACHMENT_COPY = "Attach a PDF, JPEG or PNG file.";

function cleanCopy(kind: AttachmentKind, file: Buffer): Buffer | null {
  if (kind === "pdf") return null;
  try {
    return kind === "jpeg" ? cleanJpeg(file) : cleanPng(file);
  } catch {
    throw invalid({ attachment: ATTACHMENT_COPY });
  }
}

interface MessageRow {
  id: string;
  from_role: MessageView["from"]["role"];
  from_name: string;
  body: string;
  sent_at: Date;
  attachment_id: string | null;
  attachment_kind: AttachmentKind | null;
  attachment_bytes: number | null;
}

function messageView(row: MessageRow): MessageView {
  return {
    id: row.id,
    from: { role: row.from_role, name: row.from_name },
    body: row.body,
    attachment: row.attachment_id && row.attachment_kind && row.attachment_bytes !== null
      ? { id: row.attachment_id, kind: row.attachment_kind, bytes: row.attachment_bytes }
      : null,
    sentAt: wholeSeconds(row.sent_at),
  };
}

export async function memberMessages(memberId: string): Promise<MessageView[]> {
  const found = await rows<MessageRow>(
    pool,
    `SELECT m.id, m.from_role, m.from_name, m.body, m.sent_at, a.id AS attachment_id, a.kind AS attachment_kind, a.bytes AS attachment_bytes
     FROM messages m LEFT JOIN attachments a ON a.message_id = m.id WHERE m.member_id = $1 ORDER BY m.seq`,
    [memberId],
  );
  return found.map(messageView);
}

const objectKey = (memberId: string, attachmentId: string, which: "original" | "clean"): string =>
  `members/${memberId}/attachments/${attachmentId}/${which}`;

interface Sender {
  memberId: string;
  role: MessageView["from"]["role"];
  name: string;
  countsAgainstLimit: boolean;
}

export async function sendMessage(sender: Sender, parts: Multipart, now: Date): Promise<MessageView> {
  const body = parts.fields.get("body") ?? "";
  const length = [...body].length;
  const fields: Record<string, string> = {};
  if (length === 0) fields["body"] = "Write a message first.";
  else if (length > BODY_LIMIT) fields["body"] = "Keep your message to 2,000 characters.";
  const file = parts.files.get("attachment");
  const hasFile = file !== undefined && file.length > 0;
  const kind = hasFile ? kindOf(file) : null;
  if (hasFile && !kind) fields["attachment"] = ATTACHMENT_COPY;
  if (Object.keys(fields).length > 0) throw invalid(fields);

  const attachmentId = randomUUID();
  if (hasFile && kind) {
    const clean = cleanCopy(kind, file);
    try {
      await putObject(objectKey(sender.memberId, attachmentId, "original"), file);
      if (clean) await putObject(objectKey(sender.memberId, attachmentId, "clean"), clean);
    } catch (error) {
      if (error instanceof StoreUnavailable) throw attachmentStore503();
      throw error;
    }
  }

  const id = randomUUID();
  await inTransaction(async (db) => {
    await db.query(
      "INSERT INTO messages (id, member_id, from_role, from_name, body, sent_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [id, sender.memberId, sender.role, sender.name, body, now],
    );
    if (hasFile && kind) {
      await db.query("INSERT INTO attachments (id, message_id, member_id, kind, bytes) VALUES ($1, $2, $3, $4, $5)", [
        attachmentId, id, sender.memberId, kind, file.length,
      ]);
    }
    if (sender.countsAgainstLimit) {
      await db.query("UPDATE members SET thread_state = 'open' WHERE id = $1", [sender.memberId]);
      await countMessage(db, sender.memberId, now);
    }
  });
  return {
    id,
    from: { role: sender.role, name: sender.name },
    body,
    attachment: hasFile && kind ? { id: attachmentId, kind, bytes: file.length } : null,
    sentAt: wholeSeconds(now),
  };
}

export async function markThreadHandled(memberId: string): Promise<void> {
  await pool.query("UPDATE members SET thread_state = 'handled' WHERE id = $1", [memberId]);
}

export async function messageThreads(): Promise<ThreadView[]> {
  const found = await rows<{ id: string; name: string; thread_state: ThreadView["state"]; last_at: Date }>(
    pool,
    `SELECT mem.id, p.name, mem.thread_state, max(m.sent_at) AS last_at
     FROM messages m JOIN members mem ON mem.id = m.member_id JOIN people p ON p.id = mem.id
     GROUP BY mem.id, p.name, mem.thread_state
     ORDER BY (mem.thread_state = 'handled'), max(m.sent_at)`,
  );
  return found.map((row) => ({ memberId: row.id, memberName: row.name, state: row.thread_state, lastMessageAt: wholeSeconds(row.last_at) }));
}

interface AttachmentRow {
  id: string;
  member_id: string;
  kind: AttachmentKind;
}

export async function locateAttachment(id: string): Promise<AttachmentRow | undefined> {
  return one<AttachmentRow>(pool, "SELECT id, member_id, kind FROM attachments WHERE id = $1", [id]);
}

const CONTENT_TYPE: Record<AttachmentKind, string> = { pdf: "application/pdf", jpeg: "image/jpeg", png: "image/png" };

export async function attachmentBytes(attachment: AttachmentRow, which: "original" | "shown"): Promise<{ bytes: Buffer; contentType: string }> {
  const object = which === "shown" && attachment.kind !== "pdf" ? "clean" : "original";
  try {
    return { bytes: await getObject(objectKey(attachment.member_id, attachment.id, object)), contentType: CONTENT_TYPE[attachment.kind] };
  } catch (error) {
    if (error instanceof StoreUnavailable) throw attachmentStore503();
    throw error;
  }
}
