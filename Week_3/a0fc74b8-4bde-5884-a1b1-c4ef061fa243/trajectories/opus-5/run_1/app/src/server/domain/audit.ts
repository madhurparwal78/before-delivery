import { createHash } from 'node:crypto';
import type pg from 'pg';
import type { AuditEventJson } from '../../shared/types.ts';

export type AuditType =
  | 'document.created'
  | 'document.sent'
  | 'invite.sent'
  | 'invite.held'
  | 'recipient.viewed'
  | 'recipient.signed'
  | 'recipient.declined'
  | 'document.voided'
  | 'reminder.sent'
  | 'link.resent'
  | 'document.sealed'
  | 'document.completed';

export const ZERO_HASH = '0'.repeat(64);

/** The one place that computes an audit event's hash. */
export const auditHash = (
  prevHash: string,
  seq: number,
  type: string,
  recipientId: string | null,
  at: string,
): string =>
  createHash('sha256')
    .update(`${prevHash}|${seq}|${type}|${recipientId ?? '-'}|${at}`, 'utf8')
    .digest('hex');

export interface AuditInput {
  documentId: string;
  type: AuditType;
  actor: string;
  recipientId?: string | null;
  at?: Date;
}

export const appendAudit = async (
  client: pg.PoolClient,
  input: AuditInput,
): Promise<AuditEventJson> => {
  const previous = await client.query<{ seq: number; hash: string }>(
    'SELECT seq, hash FROM audit_events WHERE document_id = $1 ORDER BY seq DESC LIMIT 1',
    [input.documentId],
  );
  const head = previous.rows[0];
  const seq = (head?.seq ?? 0) + 1;
  const prevHash = head?.hash ?? ZERO_HASH;
  const recipientId = input.recipientId ?? null;
  const at = (input.at ?? new Date()).toISOString();
  const hash = auditHash(prevHash, seq, input.type, recipientId, at);
  await client.query(
    `INSERT INTO audit_events (document_id, seq, type, actor, recipient_id, at_text, prev_hash, hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [input.documentId, seq, input.type, input.actor, recipientId, at, prevHash, hash],
  );
  return { seq, type: input.type, actor: input.actor, recipientId, at, prevHash, hash };
};

export const auditChainHead = async (
  client: pg.PoolClient,
  documentId: string,
): Promise<string> => {
  const result = await client.query<{ hash: string }>(
    'SELECT hash FROM audit_events WHERE document_id = $1 ORDER BY seq DESC LIMIT 1',
    [documentId],
  );
  return result.rows[0]?.hash ?? ZERO_HASH;
};
