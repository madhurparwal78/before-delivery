// Lifecycle sweeps (brief: Lifecycle rules). Each version and upload is judged against the second the
// sweep runs; concurrent sweeps never expire a version or abort an upload twice.
import { config } from "./config.js";
import { lockKey, one, pool, query, tx } from "./db.js";
import { processByteRemovals, removeVersion, type Bucket, type Version } from "./objects.js";
import { abortOpenUpload } from "./s3api.js";
import { isLocked } from "../shared/locks.js";

interface SweepResult {
  expired_versions: number;
  aborted_uploads: number;
  skipped_locked: number;
}

interface Candidate {
  version_id: string;
  bucket_id: number;
  key: string;
}

// The keep rule: a key's noncurrent versions ordered by noncurrent_since, newest first (ties: newer
// creation first); the first keep_newest_noncurrent are never expired. Locked versions count.
async function keptRank(db: Parameters<typeof query>[0], version: Version): Promise<number> {
  const row = await one<{ newer: number }>(db,
    `SELECT count(*)::int AS newer FROM versions WHERE bucket_id = $1 AND key = $2 AND NOT current AND version_id <> $3
       AND (noncurrent_since > $4 OR (noncurrent_since = $4 AND created_at > $5))`,
    [version.bucket_id, version.key, version.version_id, version.noncurrent_since, version.created_at]);
  return row?.newer ?? 0;
}

// The due rule: noncurrent_since + noncurrent_days lifecycle days, never counted from creation.
const isDue = (version: Version, days: number, now: Date): boolean =>
  version.noncurrent_since !== null && now.getTime() >= version.noncurrent_since.getTime() + days * config.daySeconds * 1000;

export async function sweepLifecycle(): Promise<SweepResult> {
  const now = new Date(Math.floor(Date.now() / 1000) * 1000);
  const result: SweepResult = { expired_versions: 0, aborted_uploads: 0, skipped_locked: 0 };
  const candidates = await query<Candidate>(pool,
    `SELECT v.version_id, v.bucket_id, v.key FROM (
       SELECT v.*, row_number() OVER (PARTITION BY v.bucket_id, v.key ORDER BY v.noncurrent_since DESC, v.created_at DESC) AS rank
       FROM versions v WHERE NOT v.current) v
     JOIN buckets b ON b.id = v.bucket_id JOIN workspaces w ON w.id = b.workspace_id
     WHERE w.status = 'active' AND b.noncurrent_days IS NOT NULL AND v.rank > b.keep_newest_noncurrent
       AND v.noncurrent_since + make_interval(secs => b.noncurrent_days * $2::float8) <= $1
     ORDER BY v.noncurrent_since`, [now, config.daySeconds]);
  for (const candidate of candidates) {
    const outcome = await tx(async (client) => {
      await lockKey(client, candidate.bucket_id, candidate.key);
      const version = await one<Version>(client, "SELECT * FROM versions WHERE version_id = $1 AND NOT current", [candidate.version_id]);
      const bucket = await one<Bucket & { status: string }>(client,
        "SELECT b.*, w.status FROM buckets b JOIN workspaces w ON w.id = b.workspace_id WHERE b.id = $1", [candidate.bucket_id]);
      if (!version || !bucket || bucket.status !== "active" || bucket.noncurrent_days === null) return "none";
      if (!isDue(version, bucket.noncurrent_days, now) || await keptRank(client, version) < bucket.keep_newest_noncurrent) return "none";
      if (isLocked(version, now)) return "locked";
      await removeVersion(client, bucket, version, "lifecycle", now);
      return "expired";
    });
    if (outcome === "expired") result.expired_versions += 1;
    if (outcome === "locked") result.skipped_locked += 1;
  }
  const uploads = await query<{ upload_id: string }>(pool,
    `SELECT u.upload_id FROM uploads u JOIN buckets b ON b.id = u.bucket_id JOIN workspaces w ON w.id = b.workspace_id
     WHERE u.state = 'open' AND w.status = 'active' AND b.abort_multipart_days IS NOT NULL
       AND u.initiated_at + make_interval(secs => b.abort_multipart_days * $2::float8) <= $1`, [now, config.daySeconds]);
  for (const upload of uploads) {
    if (await abortOpenUpload(upload.upload_id)) result.aborted_uploads += 1;
  }
  await processByteRemovals();
  return result;
}

// Housekeeping of rolling-window and idempotency records that no rule reads any more.
async function prune(): Promise<void> {
  await pool.query("DELETE FROM share_link_hits WHERE at < now() - interval '120 seconds'");
  await pool.query("DELETE FROM signin_failures WHERE failed_at < now() - make_interval(secs => $1)", [config.signinWindowSeconds * 2]);
  await pool.query("DELETE FROM idempotency_records WHERE created_at < now() - make_interval(secs => $1)", [config.idempotencyTtlSeconds]);
}

export function startLifecycleWorker(): void {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await sweepLifecycle();
      await prune();
    } catch {
      // Postgres or MinIO unavailable: the next sweep retries.
    } finally {
      running = false;
    }
  };
  setInterval(() => void tick(), config.lifecycleSweepSeconds * 1000).unref();
}

// Bytes of removed versions and aborted uploads leave MinIO within a second of the change, and a
// failed removal is retried until it succeeds.
export function startByteRemovalWorker(): void {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    void processByteRemovals().catch(() => undefined).finally(() => {
      running = false;
    });
  }, 1000).unref();
}
