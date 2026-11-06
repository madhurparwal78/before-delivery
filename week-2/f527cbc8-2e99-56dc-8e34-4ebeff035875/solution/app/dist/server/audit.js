// The append-only audit log: each state change writes exactly one attributed entry in its own transaction
// (brief: Business rules, Audit log; API, Audit).
import { now } from "./clock.js";
import { currentContext } from "./context.js";
export async function audit(client, entry) {
    const context = currentContext();
    const actor = entry.actor ?? context.actor;
    await client.query(`INSERT INTO audit_log (at, actor_type, actor_id, action, entity_type, entity_id, from_state, to_state, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [new Date(now()), actor.type, actor.id, entry.action, entry.entityType, entry.entityId, entry.from, entry.to, context.requestId]);
}
