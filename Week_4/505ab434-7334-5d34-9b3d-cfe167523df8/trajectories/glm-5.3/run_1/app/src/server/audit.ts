import { createHash } from 'node:crypto';
import type { Tx } from './db';

export type AuditAction =
  | 'request.submitted'
  | 'request.assigned'
  | 'request.decided'
  | 'request.withdrawn'
  | 'request.escalated'
  | 'request.expired'
  | 'condition.added'
  | 'grant.minted'
  | 'grant.activated'
  | 'grant.revoked'
  | 'proof.uploaded'
  | 'proof.accepted'
  | 'proof.rejected'
  | 'asset.released'
  | 'asset.restricted'
  | 'asset.retired'
  | 'chapter.submitted'
  | 'chapter.approved'
  | 'chapter.changes_requested'
  | 'chapter.published'
  | 'link.issued';

export interface AuditInput {
  occurredAt: Date;
  actorId: string;
  actorRole: string;
  action: AuditAction;
  resourceType: string;
  resourceId: string;
  requestId: string | null;
  before: unknown;
  after: unknown;
  outcome: 'success' | 'denied';
}

const HASH_KEYS = [
  'sequence',
  'occurredAt',
  'actorId',
  'actorRole',
  'action',
  'resourceType',
  'resourceId',
  'requestId',
  'before',
  'after',
  'outcome',
];

const ZERO_HASH = '0'.repeat(64);

export interface AuditRecord extends AuditInput {
  sequence: number;
  previousHash: string;
  recordHash: string;
}

export function canonicalForm(rec: {
  sequence: number;
  occurredAt: Date;
  actorId: string;
  actorRole: string;
  action: string;
  resourceType: string;
  resourceId: string;
  requestId: string | null;
  before: unknown;
  after: unknown;
  outcome: string;
}): string {
  const canonical: Record<string, unknown> = {};
  for (const key of HASH_KEYS) {
    canonical[key as string] = serialize(rec[key as keyof typeof rec]);
  }
  return JSON.stringify(canonical);
}

function serialize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = serialize((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

export function recordHashFor(previousHash: string, canonical: string): string {
  return createHash('sha256').update(`${previousHash}\n${canonical}`, 'utf8').digest('hex');
}

export async function appendAudit(tx: Tx, input: AuditInput): Promise<AuditRecord> {
  const locked = await tx.query<{ last_sequence: string }>(
    'SELECT last_sequence FROM audit_sequence WHERE singleton = true FOR UPDATE',
  );
  const sequence = Number(locked.rows[0].last_sequence) + 1;
  const previousHash =
    sequence === 1
      ? ZERO_HASH
      : (
          await tx.query<{ record_hash: string }>('SELECT record_hash FROM audit_records WHERE sequence = $1', [
            sequence - 1,
          ])
        ).rows[0]?.record_hash ?? ZERO_HASH;
  const canonical = canonicalForm({ ...input, sequence });
  const recordHash = recordHashFor(previousHash, canonical);
  await tx.query(
    `INSERT INTO audit_records (sequence, occurred_at, actor_id, actor_role, action, resource_type,
       resource_id, request_id, before, after, outcome, previous_hash, record_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      sequence,
      input.occurredAt,
      input.actorId,
      input.actorRole,
      input.action,
      input.resourceType,
      input.resourceId,
      input.requestId,
      JSON.stringify(serialize(input.before)),
      JSON.stringify(serialize(input.after)),
      input.outcome,
      previousHash,
      recordHash,
    ],
  );
  await tx.query('UPDATE audit_sequence SET last_sequence = $1 WHERE singleton = true', [sequence]);
  return { ...input, sequence, previousHash, recordHash };
}

export interface ChainStatus {
  ok: boolean;
  records: number;
  brokenAt: number | null;
}

export function computeChainStatus(rows: { sequence: number; previousHash: string; recordHash: string; occurredAt: Date; actorId: string; actorRole: string; action: string; resourceType: string; resourceId: string; requestId: string | null; before: unknown; after: unknown; outcome: string }[]): ChainStatus {
  let previous = ZERO_HASH;
  for (const row of rows) {
    const expectedPrevious = row.previousHash;
    if (expectedPrevious !== previous) return { ok: false, records: rows.length, brokenAt: row.sequence };
    const canonical = canonicalForm(row);
    const recomputed = recordHashFor(previous, canonical);
    if (recomputed !== row.recordHash) return { ok: false, records: rows.length, brokenAt: row.sequence };
    previous = row.recordHash;
  }
  return { ok: true, records: rows.length, brokenAt: null };
}
