import { query } from './db.js';
import { deleteObject } from './storage.js';

/**
 * Deletes storage objects now, or notes them for the next server start when storage is down.
 */
export const forgetStoredObjects = async (keys: readonly string[]): Promise<void> => {
  for (const key of keys) {
    try {
      await deleteObject(key);
    } catch {
      await query('insert into orphan_objects (object_key) values ($1) on conflict do nothing', [key]);
    }
  }
};

export const sweepOrphanObjects = async (): Promise<void> => {
  const rows = await query<{ object_key: string }>('select object_key from orphan_objects');
  for (const row of rows) {
    try {
      await deleteObject(row.object_key);
      await query('delete from orphan_objects where object_key = $1', [row.object_key]);
    } catch {
      return;
    }
  }
};
