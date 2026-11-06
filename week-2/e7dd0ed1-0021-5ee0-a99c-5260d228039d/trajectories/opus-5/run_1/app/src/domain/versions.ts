import type { PoolClient } from '../db';
import { advisoryLock, one, query, row } from '../db';
import { apiError } from '../errors';
import { isoSecond } from '../format';
import { randomToken } from '../crypto/seal';
import { nowSecond } from '../http/core';
import type { BucketRecord } from './buckets';
import { emitEvent } from './events';
import { createReplicas, restoreReplicas, supersedeReplicas } from './replicas';
import { noteStoredBytes, recordRequestUnits } from './usage';

export interface VersionRecord {
  version_id: string;
  bucket: string;
  object_key: string;
  size: string;
  etag: string;
  content_type: string;
  metadata: Record<string, string>;
  tags: Record<string, string>;
  checksum_algorithm: string | null;
  checksum_value: string | null;
  part_md5s: string[] | null;
  part_sizes: number[] | null;
  created_at: string;
  acknowledged_at: string;
  is_current: boolean;
  noncurrent_since: string | null;
  retain_until: string | null;
  legal_hold: boolean;
  wrapped_data_key: string;
  key_generation: number;
}

const versionColumns = `version_id, bucket, object_key, size::text as size, etag, content_type, metadata, tags,
  checksum_algorithm, checksum_value, part_md5s, part_sizes, created_at, acknowledged_at, is_current,
  noncurrent_since, retain_until, legal_hold, wrapped_data_key, key_generation`;

export function newVersionId(): string {
  return randomToken().slice(0, 32);
}

/** The one lock rule: a version is locked while on legal hold or before its retain-until second. */
export function isLocked(version: Pick<VersionRecord, 'legal_hold' | 'retain_until'>, at: Date = new Date()): boolean {
  if (version.legal_hold) return true;
  if (!version.retain_until) return false;
  return at.getTime() < new Date(version.retain_until).getTime();
}

export async function currentVersion(bucket: string, key: string): Promise<VersionRecord | null> {
  return one<VersionRecord>(`select ${versionColumns} from object_versions where bucket = $1 and object_key = $2 and is_current`, [
    bucket,
    key,
  ]) as Promise<VersionRecord | null>;
}

export async function currentVersionIn(client: PoolClient, bucket: string, key: string): Promise<VersionRecord | null> {
  return row<VersionRecord>(client, `select ${versionColumns} from object_versions where bucket = $1 and object_key = $2 and is_current`, [
    bucket,
    key,
  ]);
}

export async function versionById(bucket: string, versionId: string): Promise<VersionRecord | null> {
  return one<VersionRecord>(`select ${versionColumns} from object_versions where bucket = $1 and version_id = $2`, [
    bucket,
    versionId,
  ]) as Promise<VersionRecord | null>;
}

export async function versionByIdIn(client: PoolClient, bucket: string, versionId: string): Promise<VersionRecord | null> {
  return row<VersionRecord>(client, `select ${versionColumns} from object_versions where bucket = $1 and version_id = $2 for update`, [
    bucket,
    versionId,
  ]);
}

export async function listVersions(bucket: string, key: string): Promise<VersionRecord[]> {
  return query<VersionRecord>(
    `select ${versionColumns} from object_versions where bucket = $1 and object_key = $2 order by created_at desc, version_id desc`,
    [bucket, key],
  );
}

export async function lockKey(client: PoolClient, bucket: string, key: string): Promise<void> {
  await advisoryLock(client, `object:${bucket}:${key}`);
}

async function setBucketCounters(
  client: PoolClient,
  bucket: BucketRecord,
  objectDelta: number,
  bytesDelta: bigint,
  at: Date,
): Promise<void> {
  const updated = await row<{ stored_bytes: string }>(
    client,
    `update buckets set object_count = object_count + $2, stored_bytes = stored_bytes + $3
     where name = $1 returning stored_bytes::text as stored_bytes`,
    [bucket.name, objectDelta, bytesDelta.toString()],
  );
  if (bytesDelta !== 0n && updated) {
    await noteStoredBytes(client, bucket.name, bucket.workspace_slug, at, BigInt(updated.stored_bytes));
  }
}

export interface WriteVersionInput {
  bucket: BucketRecord;
  key: string;
  size: number;
  etag: string;
  contentType: string;
  metadata: Record<string, string>;
  tags: Record<string, string>;
  checksumAlgorithm?: string | null;
  checksumValue?: string | null;
  partMd5s?: string[] | null;
  partSizes?: number[] | null;
  wrappedDataKey: string;
  keyGeneration: number;
  versionId: string;
  meterRequestUnit: boolean;
  emitCreated?: boolean;
}

/** Creates a new current version, demotes the previous one and moves every counter once. */
export async function writeVersion(client: PoolClient, input: WriteVersionInput): Promise<VersionRecord> {
  const at = nowSecond();
  const previous = await currentVersionIn(client, input.bucket.name, input.key);
  if (previous) {
    await client.query('update object_versions set is_current = false, noncurrent_since = $2 where version_id = $1', [
      previous.version_id,
      at.toISOString(),
    ]);
    await supersedeReplicas(client, previous.version_id);
    await revokeLinksForKey(client, input.bucket.name, input.key);
  }
  const created = await row<VersionRecord>(
    client,
    `insert into object_versions (version_id, bucket, object_key, size, etag, content_type, metadata, tags,
        checksum_algorithm, checksum_value, part_md5s, part_sizes, created_at, acknowledged_at, is_current,
        wrapped_data_key, key_generation)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13, true, $14, $15)
     returning ${versionColumns}`,
    [
      input.versionId,
      input.bucket.name,
      input.key,
      input.size,
      input.etag,
      input.contentType,
      JSON.stringify(input.metadata),
      JSON.stringify(input.tags),
      input.checksumAlgorithm ?? null,
      input.checksumValue ?? null,
      input.partMd5s ? JSON.stringify(input.partMd5s) : null,
      input.partSizes ? JSON.stringify(input.partSizes) : null,
      at.toISOString(),
      input.wrappedDataKey,
      input.keyGeneration,
    ],
  );
  if (!created) throw apiError('service_unavailable');
  await createReplicas(client, input.versionId, input.bucket.placement, at);
  const placed = BigInt(input.bucket.placement.length);
  await setBucketCounters(client, input.bucket, previous ? 0 : 1, BigInt(input.size) * placed, at);
  if (input.meterRequestUnit) await recordRequestUnits(client, input.bucket.workspace_slug, input.bucket.name, 1);
  if (input.emitCreated !== false) {
    await emitEvent(client, {
      workspaceSlug: input.bucket.workspace_slug,
      type: 'object.created',
      bucket: input.bucket.name,
      key: input.key,
      versionId: input.versionId,
      etag: input.etag,
      size: input.size,
    });
  }
  return created;
}

/** A plain delete ends a key's current version and revokes every share link to that key. */
export async function plainDelete(
  client: PoolClient,
  bucket: BucketRecord,
  key: string,
  options: { meterRequestUnit: boolean },
): Promise<VersionRecord | null> {
  const current = await currentVersionIn(client, bucket.name, key);
  if (!current) return null;
  const at = nowSecond();
  await client.query('update object_versions set is_current = false, noncurrent_since = $2 where version_id = $1', [
    current.version_id,
    at.toISOString(),
  ]);
  await supersedeReplicas(client, current.version_id);
  await revokeLinksForKey(client, bucket.name, key);
  await setBucketCounters(client, bucket, -1, 0n, at);
  if (options.meterRequestUnit) await recordRequestUnits(client, bucket.workspace_slug, bucket.name, 1);
  await emitEvent(client, {
    workspaceSlug: bucket.workspace_slug,
    type: 'object.deleted',
    bucket: bucket.name,
    key,
    versionId: current.version_id,
    etag: current.etag,
    size: Number(current.size),
  });
  return current;
}

export async function revokeLinksForKey(client: PoolClient, bucket: string, key: string): Promise<void> {
  await client.query(
    `update share_links set state = 'revoked' where bucket = $1 and object_key = $2 and state = 'active'`,
    [bucket, key],
  );
}

export async function revokeLinksForVersion(client: PoolClient, versionId: string): Promise<void> {
  await client.query(`update share_links set state = 'revoked' where version_id = $1 and state = 'active'`, [versionId]);
}

/**
 * Removes a noncurrent version for good: index row, replicas, wrapped data key, counters, links and
 * one version.removed event. The caller has already applied the lock rule.
 */
export async function removeVersion(
  client: PoolClient,
  bucket: BucketRecord,
  version: VersionRecord,
  reason: 'request' | 'lifecycle',
): Promise<void> {
  const at = nowSecond();
  await revokeLinksForVersion(client, version.version_id);
  await client.query('delete from replicas where version_id = $1', [version.version_id]);
  await client.query('delete from object_versions where version_id = $1', [version.version_id]);
  await setBucketCounters(client, bucket, 0, -BigInt(version.size) * BigInt(bucket.placement.length), at);
  if (reason === 'request') await recordRequestUnits(client, bucket.workspace_slug, bucket.name, 1);
  await emitEvent(client, {
    workspaceSlug: bucket.workspace_slug,
    type: 'version.removed',
    bucket: bucket.name,
    key: version.object_key,
    versionId: version.version_id,
    etag: version.etag,
    size: Number(version.size),
    reason,
  });
}

/** An undo makes a deleted version current again, keeping its identity. */
export async function restoreVersion(client: PoolClient, bucket: BucketRecord, version: VersionRecord): Promise<void> {
  const at = nowSecond();
  await client.query(
    'update object_versions set is_current = true, noncurrent_since = null, acknowledged_at = $2 where version_id = $1',
    [version.version_id, at.toISOString()],
  );
  await restoreReplicas(client, version.version_id, at);
  await setBucketCounters(client, bucket, 1, 0n, at);
  await emitEvent(client, {
    workspaceSlug: bucket.workspace_slug,
    type: 'object.restored',
    bucket: bucket.name,
    key: version.object_key,
    versionId: version.version_id,
    etag: version.etag,
    size: Number(version.size),
  });
}

export function versionHistoryJson(version: VersionRecord): Record<string, unknown> {
  return {
    version_id: version.version_id,
    etag: version.etag,
    size: Number(version.size),
    created_at: isoSecond(version.created_at),
    current: version.is_current,
    noncurrent_since: version.noncurrent_since ? isoSecond(version.noncurrent_since) : null,
    retain_until: version.retain_until ? isoSecond(version.retain_until) : null,
    legal_hold: version.legal_hold,
  };
}

export async function replicaCounts(versionIds: string[]): Promise<Map<string, { settled: number; total: number }>> {
  const counts = new Map<string, { settled: number; total: number }>();
  if (versionIds.length === 0) return counts;
  const found = await query<{ version_id: string; settled: string; total: string }>(
    `select version_id, count(*) filter (where state = 'settled')::text as settled, count(*)::text as total
     from replicas where version_id = any($1) group by version_id`,
    [versionIds],
  );
  for (const item of found) counts.set(item.version_id, { settled: Number(item.settled), total: Number(item.total) });
  return counts;
}
