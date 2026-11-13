import { PoolClient } from "pg";
import { createHash } from "node:crypto";

export const AUDIT_TYPES = [
  "document.created", "document.sent", "invite.sent", "invite.held", "recipient.viewed",
  "recipient.signed", "recipient.declined", "document.voided", "reminder.sent",
  "link.resent", "document.sealed", "document.completed",
] as const;
export type AuditType = (typeof AUDIT_TYPES)[number];

/** The single place that computes the audit hash. */
export function auditHash(prevHash: string, seq: number, type: string, recipientId: string | null, at: Date): string {
  const atText = isoWithMillis(at);
  const parts = `${prevHash}|${seq}|${type}|${recipientId ?? "-"}|${atText}`;
  return createHash("sha256").update(parts, "utf-8").digest("hex");
}

export function isoWithMillis(d: Date): string {
  return d.toISOString();
}

export function isoExactMillis(d: Date): string {
  return d.toISOString();
}

/** Writes one audit event inside the caller's transaction. */
export async function writeAudit(
  client: PoolClient,
  documentId: string,
  type: AuditType,
  actor: string,
  recipientId: string | null,
  at: Date,
): Promise<void> {
  const head = await client.query<{ prev_hash: string; seq: string }>(
    "SELECT prev_hash, seq FROM audit_events WHERE document_id = $1 ORDER BY seq DESC LIMIT 1",
    [documentId],
  );
  let prevHash: string;
  let seq: number;
  if (head.rowCount === 0) {
    prevHash = "0".repeat(64);
    seq = 1;
  } else {
    prevHash = head.rows[0].prev_hash === null ? "0".repeat(64) : await lastHash(client, documentId);
    seq = Number(head.rows[0].seq) + 1;
  }
  const hash = auditHash(prevHash, seq, type, recipientId, at);
  await client.query(
    `INSERT INTO audit_events (seq, document_id, type, actor, recipient_id, at, prev_hash, hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [seq, documentId, type, actor, recipientId, at, prevHash, hash],
  );
}

async function lastHash(client: PoolClient, documentId: string): Promise<string> {
  const res = await client.query<{ hash: string }>(
    "SELECT hash FROM audit_events WHERE document_id = $1 ORDER BY seq DESC LIMIT 1",
    [documentId],
  );
  return res.rows[0]?.hash ?? "0".repeat(64);
}

export async function auditChainHead(client: PoolClient, documentId: string): Promise<string> {
  const res = await client.query<{ hash: string }>(
    "SELECT hash FROM audit_events WHERE document_id = $1 ORDER BY seq DESC LIMIT 1",
    [documentId],
  );
  return res.rows[0]?.hash ?? "0".repeat(64);
}

export async function auditChainHeadBefore(client: PoolClient, documentId: string, type: string, at: Date): Promise<string> {
  const res = await client.query<{ hash: string }>(
    "SELECT hash FROM audit_events WHERE document_id = $1 AND type = $2 AND at <= $3 ORDER BY seq DESC LIMIT 1",
    [documentId, type, at],
  );
  return res.rows[0]?.hash ?? "0".repeat(64);
}
