import { config } from "../config";
import { first, pool, rows } from "../db/pool";
import { documentsFor } from "./searchDocs";
import { documentIds, prepareIndexes, putDocuments, removeDocuments, type IndexName } from "./search";

export type SyncKey = { index: IndexName; id: string };

async function syncOne(key: SyncKey): Promise<void> {
  try {
    const queued = await first<{ seq: number }>("SELECT seq FROM search_sync WHERE index_name = $1 AND doc_id = $2", [key.index, key.id]);
    if (!queued) return;
    const [document] = await documentsFor(key.index, [key.id]);
    if (document) await putDocuments(key.index, [document]);
    else await removeDocuments(key.index, [key.id]);
    await pool.query("DELETE FROM search_sync WHERE index_name = $1 AND doc_id = $2 AND seq = $3", [key.index, key.id, queued.seq]);
  } catch {
    await pool
      .query("UPDATE search_sync SET next_attempt_at = app_now() + make_interval(secs => $3) WHERE index_name = $1 AND doc_id = $2", [
        key.index, key.id, config.limits.outboxRetrySeconds,
      ])
      .catch(() => undefined);
  }
}

/** Applies the search-sync entries written by a committed change; entries that fail stay queued for the retry job. */
export async function flushSearchSync(keys: SyncKey[]): Promise<void> {
  await Promise.all(keys.map(syncOne));
}

export async function runDueSearchSync(): Promise<void> {
  const due = await rows<{ index_name: IndexName; doc_id: string }>(
    "SELECT index_name, doc_id FROM search_sync WHERE next_attempt_at <= app_now() LIMIT 200",
  );
  await flushSearchSync(due.map((entry) => ({ index: entry.index_name, id: entry.doc_id })));
}

export async function pendingSearchSync(): Promise<number> {
  const row = await first<{ n: number }>("SELECT count(*)::int AS n FROM search_sync");
  return row ? row.n : 0;
}

let reconciled = false;

/** Makes both indexes match PostgreSQL; retried by the due jobs until search answers. */
export async function reconcileIndexes(): Promise<void> {
  if (reconciled) return;
  try {
    await prepareIndexes();
    for (const index of ["jobs", "companies"] as const) {
      const documents = await documentsFor(index);
      const wanted = new Set(documents.map((document) => String(document["id"])));
      const stale = (await documentIds(index)).filter((id) => !wanted.has(id));
      await removeDocuments(index, stale);
      for (let offset = 0; offset < documents.length; offset += 500) {
        await putDocuments(index, documents.slice(offset, offset + 500));
      }
    }
    reconciled = true;
  } catch {
    return;
  }
}
