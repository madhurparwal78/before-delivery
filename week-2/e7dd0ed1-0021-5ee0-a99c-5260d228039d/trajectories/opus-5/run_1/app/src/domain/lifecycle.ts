import { advisoryLock, rows, transaction } from '../db';
import type { PoolClient } from '../db';
import { config } from '../config';
import { nowSecond } from '../http/core';
import { loadBucketIn, type BucketRecord } from './buckets';
import { isLocked, removeVersion, type VersionRecord } from './versions';
import { abortUpload, discardStagedBytes, findUploadIn } from './multipart';
import { regionObjectKey } from '../services/storage';

export interface SweepResult {
  expiredVersions: number;
  abortedUploads: number;
  skippedLocked: number;
}

const versionColumns = `version_id, bucket, object_key, size::text as size, etag, content_type, metadata, tags,
  checksum_algorithm, checksum_value, part_md5s, part_sizes, created_at, acknowledged_at, is_current,
  noncurrent_since, retain_until, legal_hold, wrapped_data_key, key_generation`;

export async function queueByteRemoval(client: PoolClient, storageKey: string): Promise<void> {
  await client.query('insert into pending_byte_removals (storage_key) values ($1)', [storageKey]);
}

/** One lifecycle and retention day lasts FARSHORE_DAY_SECONDS seconds. */
function dayMilliseconds(count: number): number {
  return count * config.timing.day * 1000;
}

async function sweepableBuckets(): Promise<BucketRecord[]> {
  return transaction(async (client) =>
    rows<BucketRecord>(
      client,
      `select b.name, b.workspace_slug, b.placement, b.created_at, b.object_count::text as object_count,
              b.stored_bytes::text as stored_bytes, b.noncurrent_days, b.keep_newest_noncurrent, b.abort_multipart_days,
              b.lifecycle_updated_at
       from buckets b join workspaces w on w.slug = b.workspace_slug
       where w.status = 'active' order by b.name`,
    ),
  );
}

async function noncurrentVersions(bucket: string): Promise<VersionRecord[]> {
  return transaction(async (client) =>
    rows<VersionRecord>(client, `select ${versionColumns} from object_versions where bucket = $1 and not is_current`, [bucket]),
  );
}

async function openUploads(bucket: string): Promise<{ upload_id: string; initiated_at: string }[]> {
  return transaction(async (client) =>
    rows<{ upload_id: string; initiated_at: string }>(
      client,
      "select upload_id, initiated_at from multipart_uploads where bucket = $1 and state = 'open'",
      [bucket],
    ),
  );
}

/** The one keep-and-due rule, judged against the second the sweep runs. */
function dueVersions(bucket: BucketRecord, versions: VersionRecord[], at: Date): VersionRecord[] {
  const byKey = new Map<string, VersionRecord[]>();
  for (const version of versions) {
    const list = byKey.get(version.object_key) ?? [];
    list.push(version);
    byKey.set(version.object_key, list);
  }
  const due: VersionRecord[] = [];
  for (const list of byKey.values()) {
    const ordered = list.slice().sort((left, right) => {
      const byNoncurrent = new Date(right.noncurrent_since ?? 0).getTime() - new Date(left.noncurrent_since ?? 0).getTime();
      return byNoncurrent !== 0 ? byNoncurrent : new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
    });
    for (const version of ordered.slice(bucket.keep_newest_noncurrent)) {
      const dueAt = new Date(version.noncurrent_since ?? 0).getTime() + dayMilliseconds(bucket.noncurrent_days ?? 0);
      if (at.getTime() >= dueAt) due.push(version);
    }
  }
  return due;
}

async function expireVersion(bucketName: string, versionId: string): Promise<'expired' | 'locked' | 'gone'> {
  return transaction(async (client) => {
    await advisoryLock(client, `version:${versionId}`);
    const bucket = await loadBucketIn(client, bucketName);
    if (!bucket) return 'gone';
    const found = await rows<VersionRecord>(
      client,
      `select ${versionColumns} from object_versions where version_id = $1 and not is_current for update`,
      [versionId],
    );
    if (found.length === 0) return 'gone';
    if (isLocked(found[0])) return 'locked';
    await removeVersion(client, bucket, found[0], 'lifecycle');
    for (const region of bucket.placement) await queueByteRemoval(client, regionObjectKey(region, bucket.name, versionId));
    return 'expired';
  });
}

async function abortDueUpload(uploadId: string): Promise<boolean> {
  const aborted = await transaction(async (client) => {
    await advisoryLock(client, `upload:${uploadId}`);
    const upload = await findUploadIn(client, uploadId);
    if (!upload || upload.state !== 'open') return false;
    await abortUpload(client, upload);
    return true;
  });
  if (aborted) await discardStagedBytes(uploadId);
  return aborted;
}

export async function runLifecycleSweep(): Promise<SweepResult> {
  const result: SweepResult = { expiredVersions: 0, abortedUploads: 0, skippedLocked: 0 };
  const at = nowSecond();
  for (const bucket of await sweepableBuckets()) {
    if (bucket.noncurrent_days !== null) {
      for (const version of dueVersions(bucket, await noncurrentVersions(bucket.name), at)) {
        const outcome = await expireVersion(bucket.name, version.version_id);
        if (outcome === 'expired') result.expiredVersions += 1;
        if (outcome === 'locked') result.skippedLocked += 1;
      }
    }
    if (bucket.abort_multipart_days !== null) {
      for (const upload of await openUploads(bucket.name)) {
        const dueAt = new Date(upload.initiated_at).getTime() + dayMilliseconds(bucket.abort_multipart_days);
        if (at.getTime() < dueAt) continue;
        if (await abortDueUpload(upload.upload_id)) result.abortedUploads += 1;
      }
    }
  }
  return result;
}
