import type pg from "pg";
import { now } from "../clock.js";
import { pool, rows, tx } from "../db.js";
import { deleteObject, objectKeys } from "../services/s3.js";

// The object-removal queue, kept in PostgreSQL. Attachments move stored → removal_queued →
// removed; a key is queued at most once and retried until storage answers.

export async function queueAttachmentRemoval(client: pg.PoolClient, attachments: { id: string; workspace_id: string; message_id: string }[]): Promise<string[]> {
  const keys: string[] = [];
  const at = now();
  for (const attachment of attachments) {
    await client.query("UPDATE attachments SET state = 'removal_queued' WHERE id = $1", [attachment.id]);
    const { original, thumb } = objectKeys(attachment.workspace_id, attachment.message_id, attachment.id);
    for (const key of [original, thumb]) {
      await client.query("INSERT INTO removal_queue (object_key, attachment_id, queued_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [key, attachment.id, at]);
      keys.push(key);
    }
  }
  return keys;
}

// Removes queued objects (all of them, or just `only`), stopping at the first storage failure.
export async function processRemovals(only: string[] | null, timeoutMs: number): Promise<void> {
  await tx(async (client) => {
    const queued = await rows<{ object_key: string; attachment_id: string | null }>(
      client,
      `SELECT object_key, attachment_id FROM removal_queue
        WHERE $1::text[] IS NULL OR object_key = ANY($1::text[])
        ORDER BY queued_at LIMIT 200 FOR UPDATE SKIP LOCKED`,
      [only],
    );
    const touched = new Set<string>();
    for (const item of queued) {
      try {
        await deleteObject(item.object_key, timeoutMs);
      } catch {
        break;
      }
      await client.query("DELETE FROM removal_queue WHERE object_key = $1", [item.object_key]);
      if (item.attachment_id) touched.add(item.attachment_id);
    }
    if (touched.size > 0) {
      await client.query(
        `UPDATE attachments a SET state = 'removed'
          WHERE a.id = ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM removal_queue q WHERE q.attachment_id = a.id)`,
        [[...touched]],
      );
    }
  });
}

// Objects written for a send that then failed or lost a race: removed at once, and any key that
// cannot be removed goes on the queue.
export async function discardObjects(keys: string[]): Promise<void> {
  const leftover: string[] = [];
  for (const key of keys) {
    try {
      await deleteObject(key, 3_000);
    } catch {
      leftover.push(key);
    }
  }
  const at = now();
  for (const key of leftover) {
    await pool.query("INSERT INTO removal_queue (object_key, attachment_id, queued_at) VALUES ($1, NULL, $2) ON CONFLICT DO NOTHING", [key, at]);
  }
}
