import { pool, rows } from "./db";
import { deleteObjects } from "./s3";

/** Deletes stored objects that no row points at any more. Keys storage could not delete stay listed for the next start. */
export async function purgeObjects(keys: readonly string[]): Promise<void> {
  const deleted = await deleteObjects(keys);
  if (deleted.length > 0) await pool.query("DELETE FROM orphaned_objects WHERE object_key = ANY($1)", [deleted]);
}

export async function sweepOrphanedObjects(): Promise<void> {
  const orphaned = await rows<{ objectKey: string }>(pool, `SELECT object_key AS "objectKey" FROM orphaned_objects`);
  await purgeObjects(orphaned.map((row) => row.objectKey));
}
