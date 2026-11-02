import type { Actor } from "./auth.ts";
import { appendAudit, ZERO_HASH, type AuditRowChange } from "./audit.ts";
import { inTransaction, type Tx } from "./db.ts";
import { forbidden, inPrecedence, unauthenticated } from "./errors.ts";
import type { Permission } from "./permissions.ts";
import { serverTime, type Role } from "./text.ts";

/** One commit order shared by every instance on the database. */
const COMMIT_ORDER_LOCK = 7_410_002;

interface WriteContext {
  tx: Tx;
  /** The seq this write's audit row takes if it commits. */
  seq: number;
  at: string;
  actor: Actor;
}

interface WriteOutcome<T> {
  audit: AuditRowChange | null;
  result: T;
}

/**
 * Runs a write at its place in the commit order: re-reads the actor's session and role inside the
 * committing transaction (DP-09), then the change, the derived recompute and the audit row commit
 * together, or nothing does.
 */
export async function commitWrite<T>(
  actor: Actor,
  permission: Permission,
  change: (w: WriteContext) => Promise<WriteOutcome<T>>,
): Promise<T> {
  return inTransaction(async (tx) => {
    await tx.query("select pg_advisory_xact_lock($1)", [COMMIT_ORDER_LOCK]);
    const session = await tx.query(
      "select u.role from sessions s join users u on u.id = s.user_id where s.token_hash = $1",
      [actor.tokenHash],
    );
    const role = session.rows[0]?.role as Role;
    await inPrecedence({
      session: () => { if (!session.rowCount) throw unauthenticated(); },
      permission: () => { if (!permission(role)) throw forbidden(); },
    });
    const last = await tx.query("select seq, at, hash from audit_log order by seq desc limit 1");
    const prev = last.rows[0] as { seq: number; at: string; hash: string } | undefined;
    const now = serverTime();
    const at = prev && prev.at > now ? prev.at : now;
    const seq = (prev?.seq ?? 0) + 1;
    const committing: Actor = { ...actor, role };
    const outcome = await change({ tx, seq, at, actor: committing });
    if (outcome.audit) {
      await appendAudit(tx, prev?.hash ?? ZERO_HASH, {
        seq, at, actor_id: actor.id, actor_role: role, action: outcome.audit.action,
        target_type: outcome.audit.targetType, target_id: outcome.audit.targetId,
        before: outcome.audit.before, after: outcome.audit.after,
      });
    }
    return outcome.result;
  });
}
