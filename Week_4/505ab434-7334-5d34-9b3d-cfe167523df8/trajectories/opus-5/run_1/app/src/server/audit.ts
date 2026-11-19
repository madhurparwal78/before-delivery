import { createHash } from 'node:crypto';
import type { Queryable } from './db.js';
import { db } from './db.js';
import { isoInstant } from './time.js';

export const ZERO_HASH = '0'.repeat(64);
const AUDIT_LOCK_KEY = 834_221;

export type AuditPayload = Record<string, string | number | boolean | null> | null;

export interface AuditInput {
  occurredAt: Date;
  actorId: string;
  actorRole: string;
  action: string;
  resourceType: string;
  resourceId: string;
  requestId: string | null;
  before: AuditPayload;
  after: AuditPayload;
  outcome: 'success' | 'denied';
}

function stringifySorted(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(stringifySorted).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stringifySorted((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

export function canonicalForm(record: AuditInput & { sequence: number }): string {
  const ordered: [string, unknown][] = [
    ['sequence', record.sequence],
    ['occurredAt', isoInstant(record.occurredAt)],
    ['actorId', record.actorId],
    ['actorRole', record.actorRole],
    ['action', record.action],
    ['resourceType', record.resourceType],
    ['resourceId', record.resourceId],
    ['requestId', record.requestId],
    ['before', record.before],
    ['after', record.after],
    ['outcome', record.outcome],
  ];
  return `{${ordered.map(([key, value]) => `${JSON.stringify(key)}:${stringifySorted(value)}`).join(',')}}`;
}

export function hashRecord(previousHash: string, canonical: string): string {
  return createHash('sha256').update(`${previousHash}\n${canonical}`, 'utf8').digest('hex');
}

export async function appendAudit(tx: Queryable, input: AuditInput): Promise<number> {
  await tx.query('select pg_advisory_xact_lock($1)', [AUDIT_LOCK_KEY]);
  const previous = await tx.query<{ sequence: number; record_hash: string }>(
    'select sequence, record_hash from audit_log order by sequence desc limit 1',
  );
  const last = previous.rows[0];
  const sequence = (last?.sequence ?? 0) + 1;
  const previousHash = last?.record_hash ?? ZERO_HASH;
  const canonical = canonicalForm({ ...input, sequence });
  const recordHash = hashRecord(previousHash, canonical);
  await tx.query(
    `insert into audit_log (sequence, occurred_at, actor_id, actor_role, action, resource_type, resource_id,
       request_id, before, after, outcome, previous_hash, record_hash)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13)`,
    [
      sequence,
      input.occurredAt,
      input.actorId,
      input.actorRole,
      input.action,
      input.resourceType,
      input.resourceId,
      input.requestId,
      input.before === null ? null : JSON.stringify(input.before),
      input.after === null ? null : JSON.stringify(input.after),
      input.outcome,
      previousHash,
      recordHash,
    ],
  );
  return sequence;
}

export interface ChainResult {
  ok: boolean;
  records: number;
  brokenAt: number | null;
}

export async function verifyChain(): Promise<ChainResult> {
  const result = await db.query<{
    sequence: number;
    occurred_at: Date;
    actor_id: string;
    actor_role: string;
    action: string;
    resource_type: string;
    resource_id: string;
    request_id: string | null;
    before: AuditPayload;
    after: AuditPayload;
    outcome: 'success' | 'denied';
    previous_hash: string;
    record_hash: string;
  }>('select * from audit_log order by sequence asc');

  let previousHash = ZERO_HASH;
  for (const row of result.rows) {
    const canonical = canonicalForm({
      sequence: row.sequence,
      occurredAt: row.occurred_at,
      actorId: row.actor_id,
      actorRole: row.actor_role,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      requestId: row.request_id,
      before: row.before,
      after: row.after,
      outcome: row.outcome,
    });
    if (row.previous_hash !== previousHash || hashRecord(row.previous_hash, canonical) !== row.record_hash) {
      return { ok: false, records: result.rows.length, brokenAt: row.sequence };
    }
    previousHash = row.record_hash;
  }
  return { ok: true, records: result.rows.length, brokenAt: null };
}
