import type { Db } from "../db.js";
import { sha256Hex } from "../util.js";
import type { AuditEventJson } from "../../shared/types.js";

type AuditType =
  | "document.created"
  | "document.sent"
  | "invite.sent"
  | "invite.held"
  | "recipient.viewed"
  | "recipient.signed"
  | "recipient.declined"
  | "document.voided"
  | "reminder.sent"
  | "link.resent"
  | "document.sealed"
  | "document.completed";

const ZERO_HASH = "0".repeat(64);

function auditHash(prevHash: string, seq: number, type: string, recipientId: string | null, at: string): string {
  return sha256Hex(`${prevHash}|${seq}|${type}|${recipientId ?? "-"}|${at}`);
}

interface AuditRow {
  seq: number;
  type: string;
  actor: string;
  recipient_id: string | null;
  at: Date;
  prev_hash: string;
  hash: string;
}

function toJson(row: AuditRow): AuditEventJson {
  return {
    seq: row.seq,
    type: row.type,
    actor: row.actor,
    recipientId: row.recipient_id,
    at: row.at.toISOString(),
    prevHash: row.prev_hash,
    hash: row.hash,
  };
}

export async function appendAudit(
  db: Db,
  documentId: string,
  type: AuditType,
  actor: string,
  recipientId: string | null,
): Promise<AuditEventJson> {
  const { rows } = await db.query<{ seq: number; hash: string }>(
    "SELECT seq, hash FROM audit_events WHERE document_id = $1 ORDER BY seq DESC LIMIT 1",
    [documentId],
  );
  const last = rows[0];
  const seq = (last?.seq ?? 0) + 1;
  const prevHash = last?.hash ?? ZERO_HASH;
  const at = new Date();
  const hash = auditHash(prevHash, seq, type, recipientId, at.toISOString());
  await db.query(
    "INSERT INTO audit_events (document_id, seq, type, actor, recipient_id, at, prev_hash, hash) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    [documentId, seq, type, actor, recipientId, at, prevHash, hash],
  );
  return { seq, type, actor, recipientId, at: at.toISOString(), prevHash, hash };
}

export async function auditTrail(db: Db, documentId: string): Promise<AuditEventJson[]> {
  const { rows } = await db.query<AuditRow>("SELECT * FROM audit_events WHERE document_id = $1 ORDER BY seq", [documentId]);
  return rows.map(toJson);
}
