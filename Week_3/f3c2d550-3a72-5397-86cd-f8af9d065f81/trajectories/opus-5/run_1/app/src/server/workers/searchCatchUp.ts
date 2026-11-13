import { nowIso } from '../domain/clock.js';
import { LOCK, pool, withAdvisoryLock } from '../db/pool.js';
import { REFERENCE_COLUMNS, toSearchDocument, type ReferenceRow } from '../db/references.js';
import { isApplied, markApplied, pendingUpdates } from '../db/searchQueue.js';
import { deleteDocument, upsertDocuments } from '../services/search.js';

/**
 * Recorded index updates are applied in the order they were recorded, each exactly once,
 * by whichever app copy holds the shared lock.
 */
export async function drainSearchQueue(): Promise<void> {
  await withAdvisoryLock(LOCK.searchCatchUp, async () => {
    for (;;) {
      const batch = await pendingUpdates(25);
      if (batch.length === 0) return;
      for (const update of batch) {
        await applyUpdate(update.reference_id, update.op);
        await markApplied(update.seq, nowIso());
      }
    }
  });
}

async function applyUpdate(referenceId: string, op: 'upsert' | 'delete'): Promise<void> {
  if (op === 'delete') {
    await deleteDocument(referenceId);
    return;
  }
  const result = await pool.query<ReferenceRow>(
    `select ${REFERENCE_COLUMNS} from reference where id = $1 and state = 'stored'`,
    [referenceId],
  );
  const row = result.rows[0];
  if (!row) return;
  await upsertDocuments([toSearchDocument(row)]);
}

const CONFIRM_TIMEOUT_MS = 10_000;

/**
 * Waits for one recorded update to reach the index, so that a write answers only once the
 * index has confirmed its document. Another app copy may be holding the drain lock and
 * working through the queue, so this waits for the row itself rather than for one drain.
 */
export async function confirmSearchUpdate(seq: number): Promise<boolean> {
  const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
  for (;;) {
    await drainSearchQueue();
    if (await isApplied(seq)) return true;
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Writes every stored reference's document, used when the index has to be rebuilt. */
export async function rebuildIndex(): Promise<void> {
  const result = await pool.query<ReferenceRow>(
    `select ${REFERENCE_COLUMNS} from reference where state = 'stored' order by captured_at`,
  );
  const documents = result.rows.map(toSearchDocument);
  for (let start = 0; start < documents.length; start += 100) {
    await upsertDocuments(documents.slice(start, start + 100));
  }
}
