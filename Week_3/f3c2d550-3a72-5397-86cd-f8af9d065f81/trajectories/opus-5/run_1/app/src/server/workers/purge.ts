import { nowIso } from '../domain/clock.js';
import { pool, withTransaction } from '../db/pool.js';
import { removeReferenceFromAllReels } from '../db/reels.js';
import { recordSearchUpdate } from '../db/searchQueue.js';
import { deleteObject } from '../services/storage.js';
import { drainSearchQueue } from './searchCatchUp.js';

/**
 * A purge deletes the photographs, removes the search document, takes the reference out of
 * every reel and leaves it findable nowhere.
 */
export async function purgeReference(referenceId: string): Promise<void> {
  const keys = await withTransaction(async (client) => {
    const row = await client.query<{ original_key: string; display_key: string }>(
      `select original_key, display_key from reference
       where id = $1 and state = 'trashed' for update`,
      [referenceId],
    );
    const found = row.rows[0];
    if (!found) return null;
    await removeReferenceFromAllReels(client, referenceId);
    await client.query(`update reference set state = 'purged' where id = $1`, [referenceId]);
    await recordSearchUpdate(client, referenceId, 'delete', nowIso());
    return found;
  });
  if (!keys) return;
  await Promise.all([
    deleteObject(keys.original_key).catch(() => undefined),
    deleteObject(keys.display_key).catch(() => undefined),
  ]);
  await drainSearchQueue().catch(() => undefined);
}

/** Every reference past its `purge_at` is purged within five seconds. */
export async function sweepPurges(): Promise<void> {
  const due = await pool.query<{ id: string }>(
    `select id from reference where state = 'trashed' and purge_at < $1::timestamptz`,
    [nowIso()],
  );
  for (const row of due.rows) {
    await purgeReference(row.id).catch(() => undefined);
  }
}
