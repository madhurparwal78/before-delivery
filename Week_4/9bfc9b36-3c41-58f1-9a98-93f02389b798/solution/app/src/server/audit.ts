import { opaqueId, run, type Queryable } from "./db.js";
import { instant, now, wholeSecond } from "./time.js";
import { keysetPage, type PageRequest } from "./paging.js";
import type { AuditRow, Page } from "../shared/types.js";

type AuditAction =
  | "account.create" | "account.delete" | "account.rename" | "account.role_change_refused"
  | "boat.create" | "boat.update" | "measurement.record" | "photo.attach"
  | "submission.create" | "submission.accept" | "submission.reject" | "submission.reverse"
  | "ruleset.create" | "ruleset.update"
  | "drawing.create" | "drawing.draw" | "drawing.assign" | "drawing.issue" | "drawing.revise"
  | "claim.take" | "claim.lay" | "claim.unlay" | "claim.release" | "claim.cut"
  | "stock.receive" | "stock.update" | "stock.count"
  | "grant.create" | "grant.withdraw" | "authority.create" | "authority.withdraw"
  | "payment.record" | "credit_note.record";

interface AuditEntry {
  actor: string;
  action: AuditAction;
  target: string;
  before?: string | null;
  after?: string | null;
  reason?: string | null;
}

/** One audit row, written in the same transaction as the change it records. */
export async function audit(db: Queryable, entry: AuditEntry): Promise<void> {
  const id = await opaqueId(db, "AU-");
  await run(
    db,
    "INSERT INTO audit_trail (id, at, actor_email, action, target, before, after, reason) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    [id, wholeSecond(now()), entry.actor, entry.action, entry.target, entry.before ?? null, entry.after ?? null, entry.reason ?? null],
  );
}

export async function auditPage(db: Queryable, request: PageRequest): Promise<Page<AuditRow>> {
  return keysetPage(db, {
    base: "SELECT *, at AS k1, seq AS k2 FROM audit_trail",
    params: [],
    types: ["timestamptz", "bigint"],
    direction: "desc",
    filter: "audit",
    request,
    map: (row) => ({
      id: row.id,
      at: instant(row.at),
      actor_email: row.actor_email,
      action: row.action,
      target: row.target,
      before: row.before,
      after: row.after,
      reason: row.reason,
    }),
  });
}
