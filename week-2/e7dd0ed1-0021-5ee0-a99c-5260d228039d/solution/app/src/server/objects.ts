// Buckets, versions and their counters (brief: Versions and conditional writes; Bucket counters;
// Storage quota; Retention and legal hold). Every write, delete, restore and removal of a version
// goes through this module, inside one Postgres change per key.
import { randomBytes } from "node:crypto";
import type pg from "pg";
import { lockKey, one, pool, query, row, type Db } from "./db.js";
import { ApiError } from "./errors.js";
import { isoOrNull, truncateToSecond } from "./http.js";
import { revokeLinks } from "./links.js";
import { createReplicas, restoreReplicas, supersedeReplicas } from "./replication.js";
import { deleteObject, putObject, regionObjectKey } from "./storage.js";
import { meter, recordStorageChange } from "./usage.js";
import { recordEvent } from "./webhooks.js";
import { isLocked } from "../shared/locks.js";
import { PLANS } from "../shared/plans.js";
import { SEED_OBJECTS } from "./schema.js";
import { md5Etag } from "./integrity.js";
import { encryptPart, newDataKey, wrapForWorkspace } from "./encryption.js";

export interface Bucket {
  id: number;
  workspace_id: string;
  name: string;
  placement: string[];
  created_at: Date;
  object_count: number;
  stored_bytes: number;
  noncurrent_days: number | null;
  keep_newest_noncurrent: number;
  abort_multipart_days: number | null;
  lifecycle_updated_at: Date | null;
}

export interface Version {
  version_id: string;
  bucket_id: number;
  key: string;
  size: number;
  etag: string;
  content_type: string;
  metadata: Record<string, string>;
  tags: Record<string, string>;
  checksum_algorithm: string | null;
  checksum_value: string | null;
  part_sizes: number[] | null;
  created_at: Date;
  last_modified: Date;
  acknowledged_at: Date;
  current: boolean;
  noncurrent_since: Date | null;
  retain_until: Date | null;
  legal_hold: boolean;
  wrapped_key: Buffer;
  key_generation: number;
}

export const newVersionId = (): string => randomBytes(16).toString("hex");

export async function bucketByName(db: Db, name: string): Promise<Bucket | undefined> {
  return one<Bucket>(db, "SELECT * FROM buckets WHERE name = $1", [name]);
}

// A bucket outside the caller's workspace is reported exactly like a missing one.
export async function workspaceBucket(db: Db, workspaceId: string, name: string): Promise<Bucket> {
  const bucket = await bucketByName(db, name);
  if (!bucket || bucket.workspace_id !== workspaceId) throw new ApiError("not_found");
  return bucket;
}

export async function currentVersion(db: Db, bucketId: number, key: string): Promise<Version | undefined> {
  return one<Version>(db, "SELECT * FROM versions WHERE bucket_id = $1 AND key = $2 AND current", [bucketId, key]);
}

export async function versionById(db: Db, bucketId: number, key: string, versionId: string): Promise<Version | undefined> {
  return one<Version>(db, "SELECT * FROM versions WHERE bucket_id = $1 AND key = $2 AND version_id = $3", [bucketId, key, versionId]);
}

// Bucket counters change in the same change that causes them (brief: Bucket counters).
async function adjustCounters(client: pg.PoolClient, bucket: Bucket, objects: number, bytes: number, at: Date): Promise<void> {
  await client.query("UPDATE buckets SET object_count = object_count + $2, stored_bytes = stored_bytes + $3 WHERE id = $1",
    [bucket.id, objects, bytes]);
  if (bytes !== 0) await recordStorageChange(client, bucket.id, at, bytes);
}

export interface Condition {
  ifMatch?: string;
  ifNoneMatch?: boolean;
}

// Conditions are judged against the key's current version; If-Match on a key with no current
// version answers 404 instead of 412.
export function checkCondition(current: Version | undefined, condition: Condition): void {
  if (condition.ifMatch !== undefined) {
    if (!current) throw new ApiError("not_found");
    if (current.etag !== condition.ifMatch) throw new ApiError("precondition_failed", undefined, { current_etag: current.etag });
  }
  if (condition.ifNoneMatch && current) {
    throw new ApiError("precondition_failed", undefined, { current_etag: current.etag });
  }
}

export function parseCondition(ifMatch: string | undefined, ifNoneMatch: string | undefined): Condition {
  const condition: Condition = {};
  if (ifMatch !== undefined) condition.ifMatch = ifMatch.trim();
  if (ifNoneMatch?.trim() === "*") condition.ifNoneMatch = true;
  return condition;
}

// ---- Quota and reservations ----

export function planOf(planId: string): (typeof PLANS)[number] {
  const plan = PLANS.find((p) => p.id === planId);
  if (!plan) throw new Error(`unknown plan ${planId}`);
  return plan;
}

export const quotaBytes = (planId: string): number | null => {
  const plan = planOf(planId);
  return plan.storageOverage === "none" ? plan.includedStorageBytes : null;
};

interface WorkspaceTotals {
  stored_bytes: number;
  reserved_bytes: number;
}

export async function workspaceTotals(db: Db, workspaceId: string): Promise<WorkspaceTotals> {
  const totals = await one<WorkspaceTotals>(db,
    `SELECT (SELECT coalesce(sum(stored_bytes), 0)::bigint FROM buckets WHERE workspace_id = $1) AS stored_bytes,
            (SELECT coalesce(sum(bytes), 0)::bigint FROM reservations WHERE workspace_id = $1) AS reserved_bytes`, [workspaceId]);
  return totals ?? { stored_bytes: 0, reserved_bytes: 0 };
}

export class QuotaRefused extends Error {
  constructor(readonly quota: number, readonly totals: WorkspaceTotals) {
    super("quota exceeded");
  }
}

// The quota check: under a lock for the workspace, admit `bytes` (size × placed regions) only when
// stored + reserved + bytes stays within the plan's included storage, and reserve them.
export async function reserve(workspaceId: string, planId: string, bytes: number,
                              part?: { uploadId: string; partNumber: number }): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT 1 FROM workspaces WHERE id = $1 FOR UPDATE", [workspaceId]);
    if (part) {
      await client.query("DELETE FROM reservations WHERE upload_id = $1 AND part_number = $2", [part.uploadId, part.partNumber]);
    }
    const quota = quotaBytes(planId);
    if (quota !== null) {
      const totals = await workspaceTotals(client, workspaceId);
      if (totals.stored_bytes + totals.reserved_bytes + bytes > quota) throw new QuotaRefused(quota, totals);
    }
    const reservation = await row<{ id: number }>(client,
      "INSERT INTO reservations (workspace_id, bytes, upload_id, part_number) VALUES ($1, $2, $3, $4) RETURNING id",
      [workspaceId, bytes, part?.uploadId ?? null, part?.partNumber ?? null]);
    await client.query("COMMIT");
    return reservation.id;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function releaseReservation(id: number): Promise<void> {
  await pool.query("DELETE FROM reservations WHERE id = $1", [id]);
}

export function quotaError(refused: QuotaRefused): ApiError {
  return new ApiError("quota_exceeded", undefined, {
    quota_bytes: refused.quota, stored_bytes: refused.totals.stored_bytes, reserved_bytes: refused.totals.reserved_bytes,
  });
}

// ---- Writes ----

interface NewVersion {
  bucket: Bucket;
  key: string;
  versionId: string;
  size: number;
  etag: string;
  contentType: string;
  metadata: Record<string, string>;
  tags: Record<string, string>;
  checksum: { algorithm: string; value: string } | null;
  partSizes: number[] | null;
  // The version's own data key; its bytes are already at the origin as ciphertext under it.
  dataKey: Buffer;
  condition: Condition;
  // Reservations this write turns into stored bytes.
  reservationIds: number[];
  seeded: boolean;
}

// Acknowledges a version whose bytes are already at its origin: one change makes it current,
// supersedes the previous version's replicas, moves the counters and records usage and the event.
export async function commitVersion(client: pg.PoolClient, input: NewVersion): Promise<Version> {
  const { bucket } = input;
  await lockKey(client, bucket.id, input.key);
  const previous = await currentVersion(client, bucket.id, input.key);
  checkCondition(previous, input.condition);
  const now = new Date();
  const ack = truncateToSecond(now);
  if (previous) {
    await client.query("UPDATE versions SET current = false, noncurrent_since = $2 WHERE version_id = $1", [previous.version_id, ack]);
    await supersedeReplicas(client, previous.version_id);
  }
  const wrapped = await wrapForWorkspace(client, bucket.workspace_id, input.dataKey);
  const version = await row<Version>(client,
    `INSERT INTO versions (version_id, bucket_id, key, size, etag, content_type, metadata, tags, checksum_algorithm,
       checksum_value, part_sizes, created_at, last_modified, acknowledged_at, current, wrapped_key, key_generation)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,true,$14,$15) RETURNING *`,
    [input.versionId, bucket.id, input.key, input.size, input.etag, input.contentType, JSON.stringify(input.metadata),
      JSON.stringify(input.tags), input.checksum?.algorithm ?? null, input.checksum?.value ?? null, input.partSizes, now, ack,
      wrapped.wrapped_key, wrapped.key_generation]);
  await createReplicas(client, version.version_id, bucket.placement, ack);
  await adjustCounters(client, bucket, previous ? 0 : 1, input.size * bucket.placement.length, ack);
  if (input.reservationIds.length) await client.query("DELETE FROM reservations WHERE id = ANY($1)", [input.reservationIds]);
  if (!input.seeded) {
    await meter(client, bucket, "request-units", 1);
    await recordEvent(client, bucket, "object.created", version, ack);
  }
  return version;
}

// A plain delete ends the key's current version; null when there is none.
export async function plainDelete(client: pg.PoolClient, bucket: Bucket, key: string): Promise<Version | null> {
  await lockKey(client, bucket.id, key);
  const current = await currentVersion(client, bucket.id, key);
  if (!current) return null;
  const now = new Date();
  const at = truncateToSecond(now);
  await client.query("UPDATE versions SET current = false, noncurrent_since = $2 WHERE version_id = $1", [current.version_id, at]);
  await supersedeReplicas(client, current.version_id);
  await revokeLinks(client, { bucketId: bucket.id, key }, now);
  await adjustCounters(client, bucket, -1, 0, at);
  await meter(client, bucket, "request-units", 1);
  await recordEvent(client, bucket, "object.deleted", current, at);
  return current;
}

type PermanentDeleteOutcome = "removed" | "unknown";

// Permanent delete by request: only an unlocked noncurrent version.
export async function permanentDelete(client: pg.PoolClient, bucket: Bucket, key: string, versionId: string): Promise<PermanentDeleteOutcome> {
  await lockKey(client, bucket.id, key);
  const version = await versionById(client, bucket.id, key, versionId);
  if (!version) return "unknown";
  if (version.current) throw new ApiError("invalid_transition", undefined, { from: "current", to: "removed" });
  const now = new Date();
  if (isLocked(version, now)) {
    throw new ApiError("object_locked", undefined, {
      retain_until: isoOrNull(version.retain_until),
      legal_hold: version.legal_hold,
    });
  }
  await removeVersion(client, bucket, version, "request", now);
  return "removed";
}

// Removal of a noncurrent version, by request or by lifecycle expiry: one change removes it from
// every list, replica record, backlog figure and share link, and queues its bytes for removal.
export async function removeVersion(client: pg.PoolClient, bucket: Bucket, version: Version, reason: "request" | "lifecycle",
                                    now: Date): Promise<void> {
  const at = truncateToSecond(now);
  await revokeLinks(client, { versionId: version.version_id }, now);
  await client.query("DELETE FROM versions WHERE version_id = $1", [version.version_id]);
  await adjustCounters(client, bucket, 0, -version.size * bucket.placement.length, at);
  if (reason === "request") await meter(client, bucket, "request-units", 1);
  await recordEvent(client, bucket, "version.removed", version, at, reason);
  await queueByteRemoval(client, bucket.placement.map((r) => regionObjectKey(r, bucket.name, version.version_id)));
}

type RestoreOutcome = "restored" | "newer_version" | "gone";

// Undo of a plain delete: the exact deleted version becomes current again.
export async function restoreVersion(client: pg.PoolClient, bucket: Bucket, key: string, versionId: string): Promise<RestoreOutcome> {
  await lockKey(client, bucket.id, key);
  if (await currentVersion(client, bucket.id, key)) return "newer_version";
  const version = await versionById(client, bucket.id, key, versionId);
  if (!version) return "gone";
  const at = truncateToSecond(new Date());
  await client.query("UPDATE versions SET current = true, noncurrent_since = NULL, acknowledged_at = $2 WHERE version_id = $1",
    [versionId, at]);
  await restoreReplicas(client, versionId, at);
  await adjustCounters(client, bucket, 1, 0, at);
  await recordEvent(client, bucket, "object.restored", version, at);
  return "restored";
}

// ---- Byte removal ----

export async function queueByteRemoval(db: Db, keys: string[]): Promise<void> {
  if (!keys.length) return;
  await db.query(
    "INSERT INTO byte_removals (object_key, next_attempt_at) SELECT unnest($1::text[]), now() ON CONFLICT DO NOTHING", [keys]);
}

// Removes queued bytes from MinIO; failures stay queued and are retried.
export async function processByteRemovals(): Promise<void> {
  const due = await query<{ object_key: string }>(pool,
    "SELECT object_key FROM byte_removals WHERE next_attempt_at <= now() ORDER BY next_attempt_at LIMIT 200");
  for (const { object_key } of due) {
    try {
      await deleteObject(object_key);
      await pool.query("DELETE FROM byte_removals WHERE object_key = $1", [object_key]);
    } catch {
      await pool.query("UPDATE byte_removals SET next_attempt_at = now() + interval '5 seconds' WHERE object_key = $1", [object_key]);
    }
  }
}

// ---- Seed objects ----

// Writes each seeded object once if it is missing; its replicas then settle through the worker.
export async function seedObjects(): Promise<void> {
  for (const seed of SEED_OBJECTS) {
    const bucket = await bucketByName(pool, seed.bucket);
    if (!bucket) continue;
    const exists = await one(pool, "SELECT 1 FROM versions WHERE bucket_id = $1 AND key = $2", [bucket.id, seed.key]);
    if (exists) continue;
    const versionId = newVersionId();
    const bytes = Buffer.from(seed.bytes);
    const origin = bucket.placement[0] ?? "";
    const dataKey = newDataKey();
    await putObject(regionObjectKey(origin, bucket.name, versionId), encryptPart(dataKey, bytes));
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await lockKey(client, bucket.id, seed.key);
      const raced = await one(client, "SELECT 1 FROM versions WHERE bucket_id = $1 AND key = $2", [bucket.id, seed.key]);
      if (!raced) {
        await commitVersion(client, {
          bucket, key: seed.key, versionId, size: bytes.length, etag: md5Etag(bytes), contentType: seed.contentType,
          metadata: {}, tags: { ...seed.tags }, checksum: null, partSizes: null, dataKey, condition: {}, reservationIds: [], seeded: true,
        });
      }
      await client.query("COMMIT");
      if (raced) await deleteObject(regionObjectKey(origin, bucket.name, versionId)).catch(() => undefined);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

