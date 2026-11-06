import type { PoolClient } from '../db';
import { one, query, row } from '../db';
import { apiError, validation } from '../errors';
import { countCharacters } from './text';

export interface BucketRecord {
  name: string;
  workspace_slug: string;
  placement: string[];
  created_at: string;
  object_count: string;
  stored_bytes: string;
  noncurrent_days: number | null;
  keep_newest_noncurrent: number;
  abort_multipart_days: number | null;
  lifecycle_updated_at: string | null;
}

export const bucketNameMessage =
  'Bucket names are 3 to 63 lowercase letters, digits or hyphens, starting and ending with a letter or digit.';
export const placementMessage = 'Choose 1 to 4 different regions; the first is the origin.';

export function isValidBucketName(name: string): boolean {
  if (typeof name !== 'string') return false;
  if (countCharacters(name) < 3 || countCharacters(name) > 63) return false;
  if (!/^[a-z0-9-]+$/.test(name)) return false;
  if (!/^[a-z0-9]/.test(name) || !/[a-z0-9]$/.test(name)) return false;
  return !name.startsWith('xn--');
}

export function isValidPlacement(placement: unknown, knownRegions: string[]): placement is string[] {
  if (!Array.isArray(placement) || placement.length < 1 || placement.length > 4) return false;
  if (!placement.every((region) => typeof region === 'string' && knownRegions.includes(region))) return false;
  return new Set(placement as string[]).size === placement.length;
}

export async function knownRegionIds(): Promise<string[]> {
  const found = await query<{ id: string }>('select id from regions order by id');
  return found.map((region) => region.id);
}

export async function loadBucketForWorkspace(slug: string, name: string): Promise<BucketRecord | null> {
  return one<BucketRecord>(
    `select name, workspace_slug, placement, created_at, object_count::text as object_count, stored_bytes::text as stored_bytes,
            noncurrent_days, keep_newest_noncurrent, abort_multipart_days, lifecycle_updated_at
     from buckets where name = $1 and workspace_slug = $2`,
    [name, slug],
  ) as Promise<BucketRecord | null>;
}

export async function loadBucket(name: string): Promise<BucketRecord | null> {
  return one<BucketRecord>(
    `select name, workspace_slug, placement, created_at, object_count::text as object_count, stored_bytes::text as stored_bytes,
            noncurrent_days, keep_newest_noncurrent, abort_multipart_days, lifecycle_updated_at
     from buckets where name = $1`,
    [name],
  ) as Promise<BucketRecord | null>;
}

export async function loadBucketIn(client: PoolClient, name: string): Promise<BucketRecord | null> {
  return row<BucketRecord>(
    client,
    `select name, workspace_slug, placement, created_at, object_count::text as object_count, stored_bytes::text as stored_bytes,
            noncurrent_days, keep_newest_noncurrent, abort_multipart_days, lifecycle_updated_at
     from buckets where name = $1`,
    [name],
  );
}

export async function listBuckets(slug: string): Promise<BucketRecord[]> {
  return query<BucketRecord>(
    `select name, workspace_slug, placement, created_at, object_count::text as object_count, stored_bytes::text as stored_bytes,
            noncurrent_days, keep_newest_noncurrent, abort_multipart_days, lifecycle_updated_at
     from buckets where workspace_slug = $1 order by name`,
    [slug],
  );
}

export function bucketJson(bucket: BucketRecord): Record<string, unknown> {
  return {
    name: bucket.name,
    placement: bucket.placement,
    created_at: new Date(bucket.created_at).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    object_count: Number(bucket.object_count),
    stored_bytes: Number(bucket.stored_bytes),
  };
}

export async function createBucket(
  client: PoolClient,
  slug: string,
  name: string,
  placement: string[],
): Promise<BucketRecord> {
  const existing = await row<{ name: string }>(client, 'select name from buckets where name = $1', [name]);
  if (existing) throw apiError('bucket_name_taken');
  const created = await row<BucketRecord>(
    client,
    `insert into buckets (name, workspace_slug, placement, created_at, keep_newest_noncurrent)
     values ($1, $2, $3, date_trunc('second', now()), 0)
     returning name, workspace_slug, placement, created_at, object_count::text as object_count, stored_bytes::text as stored_bytes,
               noncurrent_days, keep_newest_noncurrent, abort_multipart_days, lifecycle_updated_at`,
    [name, slug, placement],
  );
  if (!created) throw apiError('bucket_name_taken');
  return created;
}

export const lifecycleMessages = {
  noncurrent_days: 'Expire noncurrent versions after 1 to 3,650 days, or leave it off.',
  keep_newest_noncurrent: 'Keep 0 to 100 newest noncurrent versions.',
  abort_multipart_days: 'Abort incomplete uploads after 1 to 365 days, or leave it off.',
};

function isIntegerInRange(value: unknown, low: number, high: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= low && value <= high;
}

export function validateLifecycle(body: Record<string, unknown>): {
  noncurrentDays: number | null;
  keepNewest: number;
  abortDays: number | null;
} {
  const failures: Record<string, string> = {};
  for (const field of ['noncurrent_days', 'keep_newest_noncurrent', 'abort_multipart_days']) {
    if (!(field in body)) failures[field] = 'This field is required.';
  }
  if (Object.keys(failures).length > 0) throw validation(failures);
  const noncurrent = body.noncurrent_days;
  const keep = body.keep_newest_noncurrent;
  const abort = body.abort_multipart_days;
  if (!(noncurrent === null || isIntegerInRange(noncurrent, 1, 3650))) failures.noncurrent_days = lifecycleMessages.noncurrent_days;
  if (!isIntegerInRange(keep, 0, 100)) failures.keep_newest_noncurrent = lifecycleMessages.keep_newest_noncurrent;
  if (!(abort === null || isIntegerInRange(abort, 1, 365))) failures.abort_multipart_days = lifecycleMessages.abort_multipart_days;
  if (Object.keys(failures).length > 0) throw validation(failures);
  return { noncurrentDays: noncurrent as number | null, keepNewest: keep as number, abortDays: abort as number | null };
}

export function lifecycleJson(bucket: BucketRecord): Record<string, unknown> {
  return {
    noncurrent_days: bucket.noncurrent_days,
    keep_newest_noncurrent: bucket.keep_newest_noncurrent,
    abort_multipart_days: bucket.abort_multipart_days,
    updated_at: bucket.lifecycle_updated_at ? new Date(bucket.lifecycle_updated_at).toISOString().replace(/\.\d{3}Z$/, 'Z') : null,
  };
}
