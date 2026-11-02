import type { Transaction } from './querier';
import { canonicalJson } from '../shared/canonical';
import type { Role } from '../shared/domain';
import { sha256Hex } from './hashutil';
import { timestampAt } from '../shared/time';

export interface AuditPayload {
  actorId: string;
  actorRole: Role;
  action: string;
  targetType: string;
  targetId: string;
  before: unknown;
  after: unknown;
}

export interface WrittenAuditRow {
  seq: number;
  at: string;
  hash: string;
}

const ZERO_HASH = '0'.repeat(64);

/**
 * Writes one audit row at the caller's place in the commit order, with the
 * gapless seq and the SHA-256 chain (DP-10, DP-12). Must run inside the
 * committing transaction; a rollback consumes no seq.
 */
export async function writeAuditRow(tx: Transaction, payload: AuditPayload): Promise<WrittenAuditRow> {
  const prev = await tx.queryOne<{ seq: string; hash: string }>(
    `SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1`
  );
  const seq = Number(prev?.seq ?? 0) + 1;
  const at = timestampAt(new Date());
  const prevHash = prev?.hash ?? ZERO_HASH;
  const canonical = canonicalJson({
    seq,
    at,
    actor_id: payload.actorId,
    actor_role: payload.actorRole,
    action: payload.action,
    target_type: payload.targetType,
    target_id: payload.targetId,
    before: normalise(payload.before),
    after: normalise(payload.after),
  });
  const hash = sha256Hex(`${prevHash}\n${canonical}`);
  await tx.query(
    `INSERT INTO audit_log (id, seq, at, actor_id, actor_role, action, target_type, target_id, before, after, prev_hash, hash)
     VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)`,
    [
      seq,
      at,
      payload.actorId,
      payload.actorRole,
      payload.action,
      payload.targetType,
      payload.targetId,
      JSON.stringify(payload.before ?? null),
      JSON.stringify(payload.after ?? null),
      prevHash,
      hash,
    ]
  );
  return { seq, at, hash };
}

/** jsonb round-trips numbers through JSON, so payloads are normalised to plain JSON values. */
function normalise(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value ?? null)) as unknown;
}

export interface ChainCheckResult {
  intact: boolean;
  checked_through: number;
  first_broken_seq: number | null;
}

/** The chain check (DP-12), recomputed from the stored column values. */
export function checkChain(rows: Array<{ seq: number; at: string; actor_id: string; actor_role: string; action: string; target_type: string; target_id: string; before: unknown; after: unknown; prev_hash: string; hash: string }>): ChainCheckResult {
  let expected = 1;
  let prevHash = ZERO_HASH;
  for (const raw of rows) {
    const row = { ...raw, seq: Number(raw.seq) };
    if (row.seq !== expected) {
      return { intact: false, checked_through: expected - 1, first_broken_seq: expected };
    }
    if (row.prev_hash !== prevHash) {
      return { intact: false, checked_through: row.seq - 1, first_broken_seq: row.seq };
    }
    const canonical = canonicalJson({
      seq: row.seq,
      at: row.at,
      actor_id: row.actor_id,
      actor_role: row.actor_role,
      action: row.action,
      target_type: row.target_type,
      target_id: row.target_id,
      before: row.before ?? null,
      after: row.after ?? null,
    });
    const hash = sha256Hex(`${row.prev_hash}\n${canonical}`);
    if (row.hash !== hash) {
      return { intact: false, checked_through: row.seq - 1, first_broken_seq: row.seq };
    }
    prevHash = row.hash;
    expected += 1;
  }
  const latest = rows.length > 0 ? Number(rows[rows.length - 1]!.seq) : 0;
  return { intact: true, checked_through: latest, first_broken_seq: null };
}
