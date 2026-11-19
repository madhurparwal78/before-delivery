import type { DbClient } from './db.js';
import { sha256Hex } from './crypto.js';

export type AuditDetailValue =
  | string
  | number
  | boolean
  | null
  | AuditDetailValue[]
  | { [k: string]: AuditDetailValue };

export type AuditDetail = { [k: string]: AuditDetailValue };

export type AuditEntry = {
  seq: string;
  id: string;
  at: string;
  actor: string;
  action: string;
  target_type: string;
  target_id: string;
  detail: AuditDetail;
  prev_hash: string;
  hash: string;
};

export type AuditAction =
  | 'grant.create'
  | 'grant.revoke'
  | 'signoff.safety'
  | 'signoff.legal'
  | 'release_record.void'
  | 'claims.validate'
  | 'release_record.clear'
  | 'content.create'
  | 'content.update'
  | 'content.submit'
  | 'content.comment'
  | 'content.approve'
  | 'content.return'
  | 'content.schedule'
  | 'content.release'
  | 'content.withdraw'
  | 'row.create'
  | 'requisition.create'
  | 'requisition.open'
  | 'requisition.close'
  | 'benefits.create'
  | 'application.stage'
  | 'application.note'
  | 'tracking_link.reissue'
  | 'application.erase'
  | 'job.retry';

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

export function auditHash(
  prevHash: string,
  entry: { seq: number; at: string; actor: string; action: string; target_type: string; target_id: string; detail: AuditDetail },
): string {
  const payload = canonicalJson({
    seq: entry.seq,
    at: entry.at,
    actor: entry.actor,
    action: entry.action,
    target_type: entry.target_type,
    target_id: entry.target_id,
    detail: entry.detail,
  });
  return sha256Hex(`${prevHash}\n${payload}`);
}

function auditTimestamp(d: Date): string {
  return `${d.toISOString().slice(0, 20)}.${String(d.getUTCMilliseconds()).padStart(3, '0')}Z`;
}

/**
 * Append one audit entry inside the caller's transaction. Sequence numbers are
 * assigned in commit order across every instance by taking the row lock on the
 * current head.
 */
export async function writeAudit(
  client: DbClient,
  entry: {
    actor: string;
    action: AuditAction | 'release_record.void' | string;
    targetType: string;
    targetId: string;
    detail: AuditDetail;
  },
): Promise<void> {
  const now = new Date();
  const at = auditTimestamp(now);
  const prev = await client.query<{ hash: string; seq: string }>(
    `SELECT seq, hash FROM audit_entries ORDER BY seq DESC LIMIT 1 FOR UPDATE`,
  );
  const seq = prev.rows.length > 0 ? BigInt(prev.rows[0].seq) + 1n : 1n;
  const prevHash = prev.rows.length > 0 ? prev.rows[0].hash : '0'.repeat(64);
  const hash = auditHash(prevHash, {
    seq: Number(seq),
    at,
    actor: entry.actor,
    action: entry.action,
    target_type: entry.targetType,
    target_id: entry.targetId,
    detail: entry.detail,
  });
  await client.query(
    `INSERT INTO audit_entries (seq, at, actor, action, target_type, target_id, detail, prev_hash, hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [seq.toString(), now.toISOString(), entry.actor, entry.action, entry.targetType, entry.targetId, JSON.stringify(entry.detail), prevHash, hash],
  );
}

export type VerifyResult =
  | { valid: true; entries: number; head: string }
  | { valid: false; entries: number; first_invalid_seq: number };

export async function verifyAuditChain(client: DbClient): Promise<VerifyResult> {
  const rows = await client.query<{ seq: string; at: Date; actor: string; action: string; target_type: string; target_id: string; detail: unknown; prev_hash: string; hash: string }>(
    `SELECT seq, at, actor, action, target_type, target_id, detail, prev_hash, hash
     FROM audit_entries ORDER BY seq ASC`,
  );
  let prevHash = '0'.repeat(64);
  let entries = 0;
  let head = prevHash;
  for (const row of rows.rows) {
    entries += 1;
    const seq = Number(row.seq);
    const at = auditTimestamp(new Date(row.at));
    const expected = auditHash(prevHash, {
      seq,
      at,
      actor: row.actor,
      action: row.action,
      target_type: row.target_type,
      target_id: row.target_id,
      detail: (row.detail ?? {}) as AuditDetail,
    });
    if (row.prev_hash !== prevHash || row.hash !== expected) {
      return { valid: false, entries, first_invalid_seq: seq };
    }
    prevHash = row.hash;
    head = row.hash;
  }
  return { valid: true, entries, head: entries === 0 ? '0'.repeat(64) : head };
}
