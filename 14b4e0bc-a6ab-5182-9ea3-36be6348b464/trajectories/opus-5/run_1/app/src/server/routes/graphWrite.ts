import type { Actor } from '../auth.ts';
import { type AuditAction, type AuditTargetType, type Json } from '../domain/audit.ts';
import { appendAudit, recheckAuthority, reserveSeq } from '../commit.ts';
import { type Queryable, withCommitOrder } from '../db.ts';
import { type Snapshot, loadCurrentSnapshot } from '../domain/snapshot.ts';
import type { Capability } from '../domain/roles.ts';
import type { Ctx, Reply } from '../http/context.ts';

export interface GraphWriteArgs {
  client: Queryable;
  actor: Actor;
  before: Snapshot;
  seq: number;
}

export interface GraphWriteResult {
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  auditBefore: Json;
  /** Built from the state the write leaves behind. */
  auditAfter: (after: Snapshot) => Json;
  status: number;
  body: (after: Snapshot) => unknown;
}

/**
 * Runs one write at its place in the commit order: existence first, then the actor's authority,
 * then the write's own checks, then its state change, recompute and audit row together.
 */
export async function graphWrite(
  ctx: Ctx,
  capability: Capability,
  existence: (client: Queryable) => Promise<void>,
  mutate: (args: GraphWriteArgs) => Promise<GraphWriteResult>,
): Promise<Reply> {
  const actor = await ctx.requireActor();
  return withCommitOrder(async (client) => {
    await existence(client);
    const current = await recheckAuthority(client, actor, capability);
    const before = await loadCurrentSnapshot(client);
    const seq = await reserveSeq(client);
    const result = await mutate({ client, actor: current, before, seq });
    const after = await loadCurrentSnapshot(client);
    await appendAudit(client, seq, {
      actorId: current.userId,
      actorRole: current.role,
      action: result.action,
      targetType: result.targetType,
      targetId: result.targetId,
      before: result.auditBefore,
      after: result.auditAfter(after),
    });
    return { status: result.status, json: result.body(after) };
  });
}
