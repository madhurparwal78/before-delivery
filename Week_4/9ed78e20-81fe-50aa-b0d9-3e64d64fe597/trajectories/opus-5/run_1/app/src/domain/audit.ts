import { createHash, randomUUID } from 'node:crypto';
import type { Queryable } from '../db/pool.js';

export const ZERO_HASH = '0'.repeat(64);
const AUDIT_LOCK_KEY = '7721450911003';

export type AuditDetail = Readonly<Record<string, unknown>>;

export type AuditEntry = {
  readonly seq: number;
  readonly id: string;
  readonly at: string;
  readonly actor: string;
  readonly action: string;
  readonly target_type: string;
  readonly target_id: string;
  readonly detail: AuditDetail;
  readonly prev_hash: string;
  readonly hash: string;
};

export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return 'null';
}

export function auditHash(
  prevHash: string,
  payload: {
    readonly seq: number;
    readonly at: string;
    readonly actor: string;
    readonly action: string;
    readonly target_type: string;
    readonly target_id: string;
    readonly detail: AuditDetail;
  },
): string {
  const canonical = canonicalJson({
    seq: payload.seq,
    at: payload.at,
    actor: payload.actor,
    action: payload.action,
    target_type: payload.target_type,
    target_id: payload.target_id,
    detail: payload.detail,
  });
  return createHash('sha256').update(`${prevHash}\n${canonical}`, 'utf8').digest('hex');
}

export async function appendAuditEntry(
  tx: Queryable,
  input: {
    readonly actor: string;
    readonly action: string;
    readonly targetType: string;
    readonly targetId: string;
    readonly detail: AuditDetail;
  },
): Promise<AuditEntry> {
  await tx.query('SELECT pg_advisory_xact_lock($1)', [AUDIT_LOCK_KEY]);
  const head = await tx.query<{ seq: number; hash: string }>(
    'SELECT seq, hash FROM audit_entries ORDER BY seq DESC LIMIT 1',
  );
  const previous = head.rows[0];
  const seq = previous === undefined ? 1 : previous.seq + 1;
  const prevHash = previous === undefined ? ZERO_HASH : previous.hash;
  const at = new Date().toISOString();
  const entry: AuditEntry = {
    seq,
    id: randomUUID(),
    at,
    actor: input.actor,
    action: input.action,
    target_type: input.targetType,
    target_id: input.targetId,
    detail: input.detail,
    prev_hash: prevHash,
    hash: auditHash(prevHash, {
      seq,
      at,
      actor: input.actor,
      action: input.action,
      target_type: input.targetType,
      target_id: input.targetId,
      detail: input.detail,
    }),
  };
  await tx.query(
    `INSERT INTO audit_entries (seq, id, at, actor, action, target_type, target_id, detail, prev_hash, hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      entry.seq,
      entry.id,
      entry.at,
      entry.actor,
      entry.action,
      entry.target_type,
      entry.target_id,
      JSON.stringify(entry.detail),
      entry.prev_hash,
      entry.hash,
    ],
  );
  return entry;
}

export type ChainReport =
  | { readonly valid: true; readonly entries: number; readonly head: string }
  | { readonly valid: false; readonly entries: number; readonly first_invalid_seq: number };

export function verifyChain(
  entries: readonly Pick<
    AuditEntry,
    'seq' | 'at' | 'actor' | 'action' | 'target_type' | 'target_id' | 'detail' | 'prev_hash' | 'hash'
  >[],
): ChainReport {
  let expectedPrev = ZERO_HASH;
  let expectedSeq = 1;
  for (const entry of entries) {
    const hash = auditHash(entry.prev_hash, {
      seq: entry.seq,
      at: entry.at,
      actor: entry.actor,
      action: entry.action,
      target_type: entry.target_type,
      target_id: entry.target_id,
      detail: entry.detail,
    });
    if (entry.seq !== expectedSeq || entry.prev_hash !== expectedPrev || entry.hash !== hash) {
      return { valid: false, entries: entries.length, first_invalid_seq: entry.seq };
    }
    expectedPrev = entry.hash;
    expectedSeq += 1;
  }
  return {
    valid: true,
    entries: entries.length,
    head: entries.length === 0 ? ZERO_HASH : (entries[entries.length - 1] as AuditEntry).hash,
  };
}
