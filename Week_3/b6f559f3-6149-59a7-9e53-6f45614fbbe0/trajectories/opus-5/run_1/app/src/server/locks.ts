import { errors } from './http';
import { copy } from '../shared/messages';
import { query, queryOne } from './db';
import { serverNow } from './clock';
import { config } from './config';
import { broadcastLock } from './ws';

export interface LockRow {
  project_id: string;
  layer_id: string;
  person_id: string;
  acquired_at: string;
  last_change_at: string;
}

export async function clearExpiredLocks(): Promise<void> {
  const now = await serverNow();
  const cutoff = new Date(now.getTime() - config.lockTimeoutSeconds * 1000);
  await query(`DELETE FROM layer_locks WHERE last_change_at < $1`, [cutoff.toISOString()]);
}

export async function lockHolder(
  projectId: string,
  layerId: string,
): Promise<{ id: string; name: string; expiresAt: string } | null> {
  await clearExpiredLocks();
  const row = await queryOne<{ person_id: string; name: string; last_change_at: string }>(
    `SELECT l.person_id, p.name, l.last_change_at FROM layer_locks l
     JOIN people p ON p.id = l.person_id
     WHERE l.project_id = $1 AND l.layer_id = $2`,
    [projectId, layerId],
  );
  if (!row) return null;
  return {
    id: row.person_id,
    name: row.name,
    expiresAt: new Date(
      new Date(row.last_change_at).getTime() + config.lockTimeoutSeconds * 1000,
    ).toISOString(),
  };
}

/** Takes a layer lock, refusing when another person holds it. */
export async function takeLock(
  projectId: string,
  layerId: string,
  personId: string,
): Promise<{ expiresAt: string }> {
  await clearExpiredLocks();
  const now = await serverNow();
  const rows = await query<{ person_id: string }>(
    `INSERT INTO layer_locks (project_id, layer_id, person_id, acquired_at, last_change_at)
     VALUES ($1,$2,$3,$4,$4)
     ON CONFLICT (project_id, layer_id) DO UPDATE SET last_change_at = $4
     WHERE layer_locks.person_id = $3
     RETURNING person_id`,
    [projectId, layerId, personId, now.toISOString()],
  );
  if (rows.length === 0) {
    const holder = await lockHolder(projectId, layerId);
    throw errors.conflict('layer_held', copy.layerHeld(holder?.name ?? 'Someone else'));
  }
  const expiresAt = new Date(now.getTime() + config.lockTimeoutSeconds * 1000).toISOString();
  broadcastLock(projectId, { layerId, heldBy: personId, expiresAt });
  return { expiresAt };
}

export async function releaseLock(
  projectId: string,
  layerId: string,
  personId: string,
): Promise<void> {
  await query(
    `DELETE FROM layer_locks WHERE project_id = $1 AND layer_id = $2 AND person_id = $3`,
    [projectId, layerId, personId],
  );
  broadcastLock(projectId, { layerId, heldBy: null });
}

export async function locksFor(projectId: string): Promise<
  { layerId: string; personId: string; name: string }[]
> {
  await clearExpiredLocks();
  const rows = await query<{ layer_id: string; person_id: string; name: string }>(
    `SELECT l.layer_id, l.person_id, p.name FROM layer_locks l JOIN people p ON p.id = l.person_id
     WHERE l.project_id = $1`,
    [projectId],
  );
  return rows.map((row) => ({ layerId: row.layer_id, personId: row.person_id, name: row.name }));
}
