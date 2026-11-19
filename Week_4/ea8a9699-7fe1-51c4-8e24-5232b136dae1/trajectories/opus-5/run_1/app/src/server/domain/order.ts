import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { errors } from '../errors.js';
import { lock } from '../db.js';
import { toPositionMessage } from '../../shared/fields.js';

/**
 * The one place that keeps a cluster's order. Every change takes the cluster lock, so appends and
 * moves from any number of instances settle at positions exactly 1 to n.
 */
export async function lockCluster(client: PoolClient, clusterId: string): Promise<void> {
  await lock(client, 'cluster-order', clusterId);
}

async function entryIdsOf(client: PoolClient, clusterId: string): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    'select id from cluster_entries where cluster_id = $1 order by position',
    [clusterId],
  );
  return result.rows.map((row) => row.id);
}

async function renumber(client: PoolClient, clusterId: string, orderedIds: readonly string[]): Promise<void> {
  for (const [index, id] of orderedIds.entries()) {
    await client.query('update cluster_entries set position = $3 where cluster_id = $1 and id = $2', [
      clusterId,
      id,
      index + 1,
    ]);
  }
}

async function bumpVersion(client: PoolClient, clusterId: string): Promise<number> {
  const result = await client.query<{ version: number }>(
    'update clusters set version = version + 1, updated_at = now() where id = $1 returning version',
    [clusterId],
  );
  return result.rows[0].version;
}

export interface AppendResult {
  entryId: string;
  position: number;
  itemCount: number;
  version: number;
}

export async function appendEntry(
  client: PoolClient,
  clusterId: string,
  referenceId: string,
  isPrivate: boolean,
  addedBy: string,
): Promise<AppendResult> {
  await lockCluster(client, clusterId);
  const existing = await client.query('select 1 from cluster_entries where cluster_id = $1 and reference_id = $2', [
    clusterId,
    referenceId,
  ]);
  if (existing.rowCount !== null && existing.rowCount > 0) {
    throw errors.alreadyInCluster();
  }
  const count = await client.query<{ count: number }>(
    'select count(*)::int as count from cluster_entries where cluster_id = $1',
    [clusterId],
  );
  const position = count.rows[0].count + 1;
  const entryId = randomUUID();
  await client.query(
    `insert into cluster_entries (id, cluster_id, reference_id, position, is_private, added_by)
          values ($1, $2, $3, $4, $5, $6)`,
    [entryId, clusterId, referenceId, position, isPrivate, addedBy],
  );
  return { entryId, position, itemCount: position, version: await bumpVersion(client, clusterId) };
}

export interface RemoveResult {
  itemCount: number;
  version: number;
}

export async function removeEntry(client: PoolClient, clusterId: string, entryId: string): Promise<RemoveResult> {
  await lockCluster(client, clusterId);
  await client.query('delete from cluster_entries where cluster_id = $1 and id = $2', [clusterId, entryId]);
  const remaining = await entryIdsOf(client, clusterId);
  await renumber(client, clusterId, remaining);
  return { itemCount: remaining.length, version: await bumpVersion(client, clusterId) };
}

export async function removeReferenceEntries(client: PoolClient, referenceId: string): Promise<void> {
  const affected = await client.query<{ cluster_id: string }>(
    'select distinct cluster_id from cluster_entries where reference_id = $1',
    [referenceId],
  );
  for (const row of affected.rows) {
    await lockCluster(client, row.cluster_id);
    await client.query('delete from cluster_entries where cluster_id = $1 and reference_id = $2', [
      row.cluster_id,
      referenceId,
    ]);
    await renumber(client, row.cluster_id, await entryIdsOf(client, row.cluster_id));
    await bumpVersion(client, row.cluster_id);
  }
}

export interface MoveResult {
  version: number;
  entryIds: string[];
}

export async function moveEntry(
  client: PoolClient,
  clusterId: string,
  entryId: string,
  toPosition: unknown,
  version: unknown,
): Promise<MoveResult> {
  await lockCluster(client, clusterId);
  const current = await client.query<{ version: number }>('select version from clusters where id = $1', [clusterId]);
  const currentVersion = current.rows[0].version;
  const orderedIds = await entryIdsOf(client, clusterId);
  if (typeof version !== 'number' || version !== currentVersion) {
    throw errors.staleOrder(currentVersion, orderedIds);
  }
  if (
    typeof toPosition !== 'number' ||
    !Number.isInteger(toPosition) ||
    toPosition < 1 ||
    toPosition > orderedIds.length
  ) {
    throw errors.validation({ toPosition: toPositionMessage(orderedIds.length) });
  }
  const index = orderedIds.indexOf(entryId);
  if (index === -1) {
    throw errors.notFound();
  }
  const reordered = [...orderedIds];
  reordered.splice(index, 1);
  reordered.splice(toPosition - 1, 0, entryId);
  await renumber(client, clusterId, reordered);
  return { version: await bumpVersion(client, clusterId), entryIds: reordered };
}

export async function markPrivacy(
  client: PoolClient,
  clusterId: string,
  entryId: string,
  isPrivate: boolean,
): Promise<{ position: number; itemCount: number; version: number }> {
  await lockCluster(client, clusterId);
  const updated = await client.query<{ position: number }>(
    'update cluster_entries set is_private = $3 where cluster_id = $1 and id = $2 returning position',
    [clusterId, entryId, isPrivate],
  );
  if (updated.rows.length === 0) {
    throw errors.notFound();
  }
  const ids = await entryIdsOf(client, clusterId);
  return {
    position: updated.rows[0].position,
    itemCount: ids.length,
    version: await bumpVersion(client, clusterId),
  };
}
