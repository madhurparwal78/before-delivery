// The attributed audit trail: one entry per staff state change and per automatic move. Never edited.
import type { User } from "../auth.ts";
import type { Db } from "../db/index.ts";
import { route, ok } from "../http.ts";
import { db } from "../db/index.ts";
import { isoUtc } from "./time.ts";

export type Actor = User | "system";

export async function audit(q: Db, actor: Actor, action: string, target: { type: string; id: string }, detail: Record<string, unknown> = {}, at: Date = new Date()): Promise<void> {
  await q.query(
    "INSERT INTO audit (at, actor, actor_role, action, target_type, target_id, detail) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [at, actor === "system" ? "system" : actor.email, actor === "system" ? "system" : actor.role, action, target.type, target.id, JSON.stringify(detail)]);
}

type AuditRow = { id: number; at: Date; actor: string; actor_role: string; action: string; target_type: string; target_id: string; detail: unknown };

route("GET", "/api/admin/audit", ["admin", "finance"], async (ctx) => {
  const limit = Math.min(Math.max(Number(ctx.query.get("limit") ?? 100) || 100, 1), 1000);
  const target = ctx.query.get("target_id");
  const rows = await db.all<AuditRow>(
    `SELECT id, at, actor, actor_role, action, target_type, target_id, detail FROM audit
     WHERE ($1::text IS NULL OR target_id = $1) ORDER BY at DESC, id DESC LIMIT $2`, [target, limit]);
  return ok({ entries: rows.map((r) => ({ ...r, id: String(r.id), at: isoUtc(r.at) })) });
});
