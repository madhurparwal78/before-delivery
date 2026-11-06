import type { Role } from '../shared/domain.ts';
import { serverTime } from '../shared/businessTime.ts';
import type { Queryable } from './db.ts';
import { type Actor, actorForToken } from './auth.ts';
import {
  type AuditAction,
  type AuditTargetType,
  type Json,
  GENESIS_HASH,
  auditHash,
} from './domain/audit.ts';
import { type Capability, allows } from './domain/roles.ts';
import { AUDIT_CHANNEL, SESSION_CHANNEL } from './events.ts';
import { errors } from './http/errors.ts';

export interface AuditInput {
  actorId: string;
  actorRole: Role;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  before: Json;
  after: Json;
}

export interface CommittedRow {
  seq: number;
  at: string;
}

/**
 * Appends one audit row at its place in the commit order and publishes it to every instance
 * when the transaction commits.
 */
export async function reserveSeq(client: Queryable): Promise<number> {
  const result = await client.query<{ seq: string | null }>('SELECT max(seq) AS seq FROM audit_log');
  return Number(result.rows[0]?.seq ?? 0) + 1;
}

export async function appendAudit(
  client: Queryable,
  seq: number,
  input: AuditInput,
): Promise<CommittedRow> {
  const previous = await client.query<{ seq: string; at: string; hash: string }>(
    'SELECT seq, at, hash FROM audit_log ORDER BY seq DESC LIMIT 1',
  );
  const last = previous.rows[0];
  const prevHash = last ? last.hash : GENESIS_HASH;
  const now = serverTime();
  // `at` never decreases as `seq` increases.
  const at = last && last.at > now ? last.at : now;
  const payload = {
    seq,
    at,
    actor_id: input.actorId,
    actor_role: input.actorRole,
    action: input.action,
    target_type: input.targetType,
    target_id: input.targetId,
    before: input.before,
    after: input.after,
  };
  const hash = auditHash(prevHash, payload);
  await client.query(
    `INSERT INTO audit_log (seq, at, actor_id, actor_role, action, target_type, target_id,
                            before, after, prev_hash, hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      seq,
      at,
      input.actorId,
      input.actorRole,
      input.action,
      input.targetType,
      input.targetId,
      JSON.stringify(input.before),
      JSON.stringify(input.after),
      prevHash,
      hash,
    ],
  );
  await client.query('SELECT pg_notify($1, $2)', [
    AUDIT_CHANNEL,
    JSON.stringify({
      seq,
      action: input.action,
      target: { type: input.targetType, id: input.targetId },
    }),
  ]);
  return { seq, at };
}

export async function announceSessionEnded(client: Queryable, tokenHashes: string[]): Promise<void> {
  for (const tokenHash of tokenHashes) {
    await client.query('SELECT pg_notify($1, $2)', [SESSION_CHANNEL, tokenHash]);
  }
}

/**
 * Every write re-reads its actor's session and role inside its committing transaction,
 * at its place in the commit order.
 */
export async function recheckAuthority(
  client: Queryable,
  actor: Actor,
  capability: Capability,
): Promise<Actor> {
  const current = await actorForToken(client, actor.tokenHash);
  if (current === null) throw errors.unauthenticated();
  if (!allows(current.role, capability)) throw errors.forbidden();
  return current;
}

/** The role the user held right after audit row `seq` committed. */
export async function roleAtSeq(client: Queryable, userId: string, seq: number): Promise<Role> {
  const result = await client.query<{ role: Role }>(
    `SELECT role FROM user_role_history
      WHERE user_id = $1 AND from_seq <= $2
      ORDER BY from_seq DESC LIMIT 1`,
    [userId, seq],
  );
  return result.rows[0].role;
}
