import type { PoolClient } from 'pg';
import { pool, query } from '../db';
import { nowDate } from '../clock';
import { deleteObject } from '../services/storage';

type Queryable = Pick<PoolClient, 'query'>;

/**
 * The one object-removal queue. It lives in PostgreSQL, so it survives
 * restarts and a storage outage, and every queued key is cleared once storage
 * answers again.
 */
export async function queueRemovals(keys: readonly string[], client: Queryable = pool): Promise<void> {
  for (const key of keys) {
    await client.query(
      'INSERT INTO removal_queue (object_key, queued_at) VALUES ($1, $2) ON CONFLICT (object_key) DO NOTHING',
      [key, nowDate()],
    );
  }
}

/** Removes keys now, leaving any that storage refuses on the queue. */
export async function removeObjects(keys: readonly string[]): Promise<void> {
  const failed: string[] = [];
  for (const key of keys) {
    try {
      await deleteObject(key);
      await query('DELETE FROM removal_queue WHERE object_key = $1', [key]);
    } catch {
      failed.push(key);
    }
  }
  if (failed.length > 0) await queueRemovals(failed);
}

export async function flushRemovalQueue(): Promise<void> {
  const rows = await query<{ object_key: string }>(
    'SELECT object_key FROM removal_queue ORDER BY queued_at ASC LIMIT 200',
  );
  for (const row of rows) {
    try {
      await deleteObject(row.object_key);
      await query('DELETE FROM removal_queue WHERE object_key = $1', [row.object_key]);
    } catch {
      return;
    }
  }
}
