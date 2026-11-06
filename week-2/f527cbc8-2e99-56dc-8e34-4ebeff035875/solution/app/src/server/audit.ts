// The append-only audit log: each state change writes exactly one attributed entry in its own transaction
// (brief: Business rules, Audit log; API, Audit).
import { now } from "./clock.js";
import { type Actor, currentContext } from "./context.js";
import type { Queryable } from "./db.js";

type AuditEntity =
  | "barn_day"
  | "booking"
  | "visit"
  | "invoice"
  | "payment"
  | "vet_link"
  | "price_list"
  | "api_token"
  | "import"
  | "dunning";

interface AuditEntry {
  action: string;
  entityType: AuditEntity;
  entityId: string;
  from: string | null;
  to: string | null;
  /** Overrides the request's actor, e.g. the system writing a hold lapse. */
  actor?: Actor;
}

export async function audit(client: Queryable, entry: AuditEntry): Promise<void> {
  const context = currentContext();
  const actor = entry.actor ?? context.actor;
  await client.query(
    `INSERT INTO audit_log (at, actor_type, actor_id, action, entity_type, entity_id, from_state, to_state, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [new Date(now()), actor.type, actor.id, entry.action, entry.entityType, entry.entityId, entry.from, entry.to, context.requestId],
  );
}
