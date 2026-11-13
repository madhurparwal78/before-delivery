import type { Role } from "../shared/api";
import type { Unit } from "./db";

interface Actor {
  id: string;
  role: Role;
}

type AuditEntity = "product" | "variant" | "order" | "return" | "trial" | "warranty_claim" | "discount_code";

/** Appends one immutable entry in the same transaction as the write it describes. */
export async function audit(
  u: Unit,
  actor: Actor,
  action: string,
  entity: AuditEntity,
  entityId: string,
  before: object | null,
  after: object | null,
  at: Date,
): Promise<void> {
  await u.db.query(
    "INSERT INTO audit_log (actor_id, action, entity, entity_id, before, after, at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [actor.id, action, entity, entityId, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after), at],
  );
}
