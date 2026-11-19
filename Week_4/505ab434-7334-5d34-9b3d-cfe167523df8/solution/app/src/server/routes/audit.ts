// The audit log: filtered reads and chain verification for owner and legal reviewers; no writes through the API.
import { config } from "../config.ts";
import { canonicalRecord, pool, recordHash } from "../db.ts";
import { ApiError, notFound } from "../errors.ts";
import { ok, type Ctx, type Router } from "../http.ts";
import { endOfDay, startOfDay } from "../../shared/dates.ts";
import type { AuditRecord, Principal } from "../../shared/api.ts";

interface AuditRow {
  sequence: number;
  occurred_at: string;
  actor_id: string;
  actor_role: string;
  action: string;
  resource_type: string;
  resource_id: string;
  request_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  outcome: "success" | "denied";
  previous_hash: string;
  record_hash: string;
  actor_name: string | null;
}

const toRecord = (row: AuditRow): AuditRecord => ({
  sequence: row.sequence,
  occurredAt: row.occurred_at,
  actorId: row.actor_id,
  actorName: row.actor_name ?? "System",
  actorRole: row.actor_role,
  action: row.action,
  resourceType: row.resource_type,
  resourceId: row.resource_id,
  requestId: row.request_id,
  before: row.before,
  after: row.after,
  outcome: row.outcome,
  previousHash: row.previous_hash,
  recordHash: row.record_hash,
});

/** The audit routes answer not found to every role but owner and legal reviewer (brief: Visibility). */
function reader(ctx: Ctx): Principal {
  const user = ctx.user();
  if (user.role !== "owner" && user.role !== "legal_reviewer") throw notFound();
  return user;
}

/** A `From` or `To` bound: a calendar date in the workspace zone, or a full ISO instant. */
function bound(value: string | null, edge: "start" | "end"): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return edge === "start" ? startOfDay(value, config.timeZone) : endOfDay(value, config.timeZone);
  const instant = Date.parse(value);
  if (Number.isNaN(instant)) throw new ApiError(422, "invalid_body", "Request body is not valid JSON.");
  return new Date(instant).toISOString();
}

export function registerAudit(router: Router): void {
  router.get("/api/audit", async (ctx) => {
    reader(ctx);
    const q = ctx.query;
    // A filter holding a NUL byte can name no record (and PostgreSQL text cannot hold one).
    if ([q.get("requestId"), q.get("action")].some((value) => value?.includes("\0"))) return ok({ records: [] });
    const rows = await pool.query<AuditRow>(
      `SELECT a.*, p.display_name AS actor_name FROM audit a LEFT JOIN principals p ON p.id = a.actor_id
        WHERE ($1::text IS NULL OR a.request_id = $1) AND ($2::text IS NULL OR a.action = $2)
          AND ($3::timestamptz IS NULL OR a.occurred_at >= $3) AND ($4::timestamptz IS NULL OR a.occurred_at <= $4)
        ORDER BY a.sequence`,
      [q.get("requestId") || null, q.get("action") || null, bound(q.get("from"), "start"), bound(q.get("to"), "end")],
    );
    return ok({ records: rows.rows.map(toRecord) });
  });

  router.get("/api/audit/verify", async (ctx) => {
    reader(ctx);
    const rows = (await pool.query<AuditRow>("SELECT a.*, NULL AS actor_name FROM audit a ORDER BY a.sequence")).rows;
    let previous = "0".repeat(64);
    for (const row of rows) {
      const record = toRecord(row);
      if (row.previous_hash !== previous || row.record_hash !== recordHash(previous, canonicalRecord(record))) {
        return ok({ ok: false, records: rows.length, brokenAt: row.sequence });
      }
      previous = row.record_hash;
    }
    return ok({ ok: true, records: rows.length, brokenAt: null });
  });

  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    router.add(method, "/api/audit/*", async (ctx) => {
      reader(ctx);
      throw new ApiError(405, "method_not_allowed", "The audit log cannot be changed.");
    });
  }
}
