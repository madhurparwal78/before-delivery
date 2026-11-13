/** Layer locks, kept in PostgreSQL and expiring in server time. */
import type { LockInfo } from '../shared/types';
import { addMs, now } from './clock';
import { config } from './config';
import { query, type Queryable } from './db';
import { broadcast } from './hub';

interface LockRow {
  layer_id: string;
  person_id: string;
  name: string;
  expires_at: Date;
}

const toLock = (row: LockRow): LockInfo => ({
  layerId: row.layer_id,
  heldBy: { id: row.person_id, name: row.name },
  expiresAt: row.expires_at.toISOString(),
});

export async function activeLocks(projectId: string, client?: Queryable): Promise<LockInfo[]> {
  const at = await now(client);
  const sql = `SELECT l.layer_id, l.person_id, p.name, l.expires_at FROM layer_locks l JOIN people p ON p.id = l.person_id
               WHERE l.project_id = $1 AND l.expires_at > $2 ORDER BY l.layer_id`;
  const rows = client ? (await client.query<LockRow>(sql, [projectId, at])).rows : await query<LockRow>(sql, [projectId, at]);
  return rows.map(toLock);
}

/** The holder (full name) of a layer's live lock when it is someone other than `personId`. */
export async function holders(projectId: string, personId: string, client: Queryable): Promise<Map<string, string>> {
  return new Map((await activeLocks(projectId, client)).filter((l) => l.heldBy.id !== personId).map((l) => [l.layerId, l.heldBy.name]));
}

/** Takes or refreshes the person's lock on layers; returns the locks written. */
export async function takeLocks(projectId: string, personId: string, name: string, layerIds: string[], client: Queryable): Promise<LockInfo[]> {
  const expires = addMs(await now(client), config.lockTimeoutSeconds * 1000);
  const written: LockInfo[] = [];
  for (const layerId of layerIds) {
    await client.query(
      `INSERT INTO layer_locks (project_id, layer_id, person_id, expires_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id, layer_id) DO UPDATE SET person_id = $3, expires_at = $4`,
      [projectId, layerId, personId, expires],
    );
    written.push({ layerId, heldBy: { id: personId, name }, expiresAt: expires.toISOString() });
  }
  return written;
}

export async function releaseLock(projectId: string, personId: string, layerId: string): Promise<boolean> {
  const rows = await query('DELETE FROM layer_locks WHERE project_id = $1 AND layer_id = $2 AND person_id = $3 RETURNING layer_id', [
    projectId,
    layerId,
    personId,
  ]);
  return rows.length > 0;
}

/** Removes locks past their server-time expiry and tells the projects' open editors. */
export async function sweepLocks(): Promise<void> {
  const at = await now();
  const rows = await query<{ project_id: string; layer_id: string }>('DELETE FROM layer_locks WHERE expires_at <= $1 RETURNING project_id, layer_id', [at]);
  for (const row of rows) broadcast(row.project_id, { type: 'unlock', layerId: row.layer_id });
}
