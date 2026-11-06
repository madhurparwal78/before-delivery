import { many, tx } from "./db.js";
import { deleteObject, listKeys, StorageUnavailable } from "./storage.js";

/** Deletes the storage objects erasure scheduled; each row is claimed by one instance and kept until done. */
export async function deleteListed(): Promise<void> {
  await tx(async (db) => {
    const rows = await many<{ key: string; is_prefix: boolean }>(
      db,
      "SELECT key, is_prefix FROM storage_deletions LIMIT 100 FOR UPDATE SKIP LOCKED",
    );
    for (const row of rows) {
      try {
        for (const key of row.is_prefix ? await listKeys(row.key) : [row.key]) await deleteObject(key);
      } catch (error) {
        if (error instanceof StorageUnavailable) return;
        throw error;
      }
      await db.query("DELETE FROM storage_deletions WHERE key = $1", [row.key]);
    }
  });
}
