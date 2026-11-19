import { newId } from '../crypto.js';
import type { ApiDeps } from './api.js';
import type { Client } from 'pg';

export async function writeActivity (client: Client, setId: string, actorId: string, action: string, target: string, summary: string): Promise<void> {
  await client.query('INSERT INTO activity (id, set_id, actor_id, action, target, summary) VALUES ($1,$2,$3,$4,$5,$6)', [newId(), setId, actorId, action, target, summary]);
}

export async function writeActivityRecord (deps: ApiDeps, setId: string, actorId: string, action: string, target: string, summary: string): Promise<void> {
  await deps.pool.query('INSERT INTO activity (id, set_id, actor_id, action, target, summary) VALUES ($1,$2,$3,$4,$5,$6)', [newId(), setId, actorId, action, target, summary]);
}
