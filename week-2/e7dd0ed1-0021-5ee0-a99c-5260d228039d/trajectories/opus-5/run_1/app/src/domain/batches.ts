import type { PoolClient } from '../db';
import { row } from '../db';
import { config } from '../config';
import { apiError } from '../errors';
import { isoSecond } from '../format';
import { randomId } from '../crypto/seal';
import { nowSecond } from '../http/core';
import type { BucketRecord } from './buckets';
import { currentVersionIn, lockKey, plainDelete, restoreVersion, versionByIdIn } from './versions';

export interface BatchItem {
  key: string;
  outcome: 'deleted' | 'not_found';
  version_id: string | null;
}

export interface BatchRecord {
  id: string;
  workspace_slug: string;
  bucket: string;
  state: string;
  undo_until: string;
  items: BatchItem[];
}

export const keysMessage = 'Choose 1 to 1,000 different keys.';

export async function runBulkDelete(
  client: PoolClient,
  bucket: BucketRecord,
  keys: string[],
): Promise<{ batchId: string | null; undoUntil: string | null; results: BatchItem[] }> {
  const results: BatchItem[] = [];
  for (const key of keys) {
    await lockKey(client, bucket.name, key);
    const deleted = await plainDelete(client, bucket, key, { meterRequestUnit: true });
    results.push(
      deleted
        ? { key, outcome: 'deleted', version_id: deleted.version_id }
        : { key, outcome: 'not_found', version_id: null },
    );
  }
  if (!results.some((item) => item.outcome === 'deleted')) return { batchId: null, undoUntil: null, results };
  const at = nowSecond();
  const undoUntil = new Date(at.getTime() + config.timing.undo * 1000);
  const id = randomId('bat');
  await client.query(
    `insert into delete_batches (id, workspace_slug, bucket, state, undo_until, created_at, items)
     values ($1, $2, $3, 'open', $4, $5, $6)`,
    [id, bucket.workspace_slug, bucket.name, undoUntil.toISOString(), at.toISOString(), JSON.stringify(results)],
  );
  return { batchId: id, undoUntil: isoSecond(undoUntil), results };
}

export interface UndoOutcome {
  key: string;
  outcome: 'restored' | 'newer_version' | 'gone';
  version_id: string;
}

/** Batch states: open → undone by an undo, open → expired at undo_until. */
export async function undoBatch(
  client: PoolClient,
  slug: string,
  batchId: string,
  loadBucket: (name: string) => Promise<BucketRecord | null>,
): Promise<{ results: UndoOutcome[] }> {
  const batch = await row<BatchRecord>(
    client,
    `select id, workspace_slug, bucket, state, undo_until, items from delete_batches
     where id = $1 and workspace_slug = $2 for update`,
    [batchId, slug],
  );
  if (!batch) throw apiError('not_found');
  if (batch.state === 'undone') {
    throw apiError('invalid_transition', 'This delete was already undone.', { from: 'undone', to: 'undone' });
  }
  if (Date.now() >= new Date(batch.undo_until).getTime()) {
    await client.query("update delete_batches set state = 'expired' where id = $1", [batch.id]);
    throw apiError('undo_expired', 'The undo window has closed.');
  }
  const bucket = await loadBucket(batch.bucket);
  if (!bucket) throw apiError('not_found');
  const results: UndoOutcome[] = [];
  for (const item of batch.items) {
    if (item.outcome !== 'deleted' || item.version_id === null) continue;
    await lockKey(client, bucket.name, item.key);
    const current = await currentVersionIn(client, bucket.name, item.key);
    if (current) {
      results.push({ key: item.key, outcome: 'newer_version', version_id: current.version_id });
      continue;
    }
    const version = await versionByIdIn(client, bucket.name, item.version_id);
    if (!version) {
      results.push({ key: item.key, outcome: 'gone', version_id: item.version_id });
      continue;
    }
    await restoreVersion(client, bucket, version);
    results.push({ key: item.key, outcome: 'restored', version_id: version.version_id });
  }
  await client.query("update delete_batches set state = 'undone' where id = $1", [batch.id]);
  return { results };
}
