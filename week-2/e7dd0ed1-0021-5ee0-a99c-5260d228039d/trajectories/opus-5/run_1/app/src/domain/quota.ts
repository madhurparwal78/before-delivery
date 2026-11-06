import type { PoolClient } from '../db';
import { advisoryLock, row } from '../db';
import { apiError } from '../errors';
import { planById } from './seeddata';

/** Included storage is a hard cap only on a plan whose storage overage is "none". */
export function quotaBytesForPlan(planId: string): number | null {
  const plan = planById(planId);
  return plan.storageOverage === 'none' ? plan.includedStorageBytes : null;
}

export async function storedBytesForWorkspace(client: PoolClient, slug: string): Promise<bigint> {
  const found = await row<{ total: string }>(client, 'select coalesce(sum(stored_bytes), 0)::text as total from buckets where workspace_slug = $1', [
    slug,
  ]);
  return BigInt(found?.total ?? '0');
}

export async function reservedBytesForWorkspace(client: PoolClient, slug: string): Promise<bigint> {
  const found = await row<{ total: string }>(
    client,
    'select coalesce(sum(bytes), 0)::text as total from quota_reservations where workspace_slug = $1',
    [slug],
  );
  return BigInt(found?.total ?? '0');
}

export interface QuotaRefusal {
  quotaBytes: number;
  storedBytes: number;
  reservedBytes: number;
}

/**
 * The one quota check. Admits an upload only when stored + reserved + incoming fits the plan's
 * included storage, and reserves the incoming bytes under a per-workspace lock.
 */
export async function reserveForUpload(
  client: PoolClient,
  options: { slug: string; planId: string; plaintextBytes: number; placedRegions: number; ref: string; reservationId: string },
): Promise<void> {
  const quota = quotaBytesForPlan(options.planId);
  if (quota === null) return;
  await advisoryLock(client, `quota:${options.slug}`);
  const stored = await storedBytesForWorkspace(client, options.slug);
  const reserved = await reservedBytesForWorkspace(client, options.slug);
  const incoming = BigInt(options.plaintextBytes) * BigInt(options.placedRegions);
  if (stored + reserved + incoming > BigInt(quota)) {
    throw apiError('quota_exceeded', 'This workspace is at its storage limit.', {
      quota_bytes: quota,
      stored_bytes: Number(stored),
      reserved_bytes: Number(reserved),
    });
  }
  await client.query('insert into quota_reservations (id, workspace_slug, bytes, ref) values ($1, $2, $3, $4)', [
    options.reservationId,
    options.slug,
    incoming.toString(),
    options.ref,
  ]);
}

export async function releaseReservation(client: PoolClient, reservationId: string): Promise<void> {
  await client.query('delete from quota_reservations where id = $1', [reservationId]);
}

export async function releaseReservationsByRef(client: PoolClient, ref: string): Promise<void> {
  await client.query('delete from quota_reservations where ref = $1', [ref]);
}

export async function releaseReservationsByRefPrefix(client: PoolClient, prefix: string): Promise<void> {
  await client.query('delete from quota_reservations where ref like $1', [`${prefix}%`]);
}
