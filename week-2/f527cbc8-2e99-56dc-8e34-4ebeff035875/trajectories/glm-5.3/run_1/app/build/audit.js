import { now } from './time.js';
export async function audit(tx, actor, action, entityType, entityId, from, to, requestId) {
    await tx.query(`insert into audit_log(at, actor_type, actor_id, action, entity_type, entity_id, from_status, to_status, request_id)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [now(), actor.type, actor.id, action, entityType, entityId, from, to, requestId]);
}
export function sessionActor(userId) {
    return { type: 'user', id: userId };
}
export function tokenActor(tokenId) {
    return { type: 'token', id: tokenId };
}
export function systemActor() {
    return { type: 'system', id: null };
}
