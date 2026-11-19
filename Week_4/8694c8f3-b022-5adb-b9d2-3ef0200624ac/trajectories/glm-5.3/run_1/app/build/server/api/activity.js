import { newId } from '../crypto.js';
export async function writeActivity(client, setId, actorId, action, target, summary) {
    await client.query('INSERT INTO activity (id, set_id, actor_id, action, target, summary) VALUES ($1,$2,$3,$4,$5,$6)', [newId(), setId, actorId, action, target, summary]);
}
export async function writeActivityRecord(deps, setId, actorId, action, target, summary) {
    await deps.pool.query('INSERT INTO activity (id, set_id, actor_id, action, target, summary) VALUES ($1,$2,$3,$4,$5,$6)', [newId(), setId, actorId, action, target, summary]);
}
