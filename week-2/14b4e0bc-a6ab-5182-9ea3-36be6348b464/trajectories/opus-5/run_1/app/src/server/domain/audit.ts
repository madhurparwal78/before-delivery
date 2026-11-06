import { createHash } from 'node:crypto';
import type { Role } from '../../shared/domain.ts';

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type AuditAction =
  | 'tag.add'
  | 'tag.withdraw'
  | 'tag.suppress'
  | 'tag.unsuppress'
  | 'tag.bulk_add'
  | 'tag.bulk_undo'
  | 'certification.verify'
  | 'certification.deprecate'
  | 'certification.reinstate'
  | 'evidence.download'
  | 'asset.register'
  | 'lineage.add'
  | 'lineage.remove'
  | 'term.create'
  | 'term.update'
  | 'term.link'
  | 'term.unlink'
  | 'user.create'
  | 'user.role_change'
  | 'user.password_reset';

export type AuditTargetType = 'column' | 'asset' | 'lineage' | 'term' | 'user';

export interface AuditPayload {
  seq: number;
  at: string;
  actor_id: string;
  actor_role: Role;
  action: AuditAction;
  target_type: AuditTargetType;
  target_id: string;
  before: Json;
  after: Json;
}

export const GENESIS_HASH = '0'.repeat(64);

/** Canonical JSON per RFC 8785: keys sorted by UTF-16 code units, no whitespace. */
export function canonicalJson(value: Json): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function auditHash(prevHash: string, payload: AuditPayload): string {
  const canonical = canonicalJson({
    seq: payload.seq,
    at: payload.at,
    actor_id: payload.actor_id,
    actor_role: payload.actor_role,
    action: payload.action,
    target_type: payload.target_type,
    target_id: payload.target_id,
    before: payload.before,
    after: payload.after,
  });
  return createHash('sha256').update(`${prevHash}\n${canonical}`, 'utf8').digest('hex');
}

export interface StoredAuditRow extends AuditPayload {
  prev_hash: string;
  hash: string;
}

export interface ChainCheck {
  intact: boolean;
  checked_through: number;
  first_broken_seq: number | null;
}

/** Walks the stored rows in ascending seq, recomputing from the stored column values. */
export function checkChain(rows: readonly StoredAuditRow[]): ChainCheck {
  let expected = 1;
  let previousHash = GENESIS_HASH;
  for (const row of rows) {
    if (row.seq !== expected) {
      return { intact: false, checked_through: expected - 1, first_broken_seq: expected };
    }
    if (row.prev_hash !== previousHash || row.hash !== auditHash(row.prev_hash, row)) {
      return { intact: false, checked_through: row.seq - 1, first_broken_seq: row.seq };
    }
    previousHash = row.hash;
    expected += 1;
  }
  return { intact: true, checked_through: expected - 1, first_broken_seq: null };
}
