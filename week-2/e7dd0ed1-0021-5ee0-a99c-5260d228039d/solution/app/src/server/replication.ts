// Replicas and the replication worker (brief: Replication; Replica state machine; Regions).
// Every replica transition is decided by REPLICA_EDGES and written through moveReplicas.
import { randomBytes } from "node:crypto";
import type pg from "pg";
import { one, pool, query, type Db } from "./db.js";
import { ApiError, transition } from "./errors.js";
import { isoOrNull } from "./http.js";
import { decryptStream, unwrapForWorkspace } from "./encryption.js";
import { copyObject, deleteObject, getObject, measurePlaintext, regionObjectKey, StorageUnavailable } from "./storage.js";

type ReplicaState = "pending" | "settled" | "failed" | "superseded";
type ReplicaError = "etag_mismatch" | "region_offline" | "copy_failed";

interface Replica {
  version_id: string;
  region: string;
  position: number;
  role: "origin" | "replica";
  state: ReplicaState;
  attempts: number;
  settled_at: Date | null;
  settle_ms: number | null;
  error: ReplicaError | null;
  pending_since: Date | null;
}

export function replicaJson(r: Replica): Record<string, unknown> {
  return {
    region: r.region, role: r.role, state: r.state, attempts: r.attempts, settled_at: isoOrNull(r.settled_at),
    settle_ms: r.settle_ms, error: r.error,
  };
}

export async function replicasOf(db: Db, versionId: string): Promise<Replica[]> {
  return query<Replica>(db, "SELECT * FROM replicas WHERE version_id = $1 ORDER BY position", [versionId]);
}

// The legal edges. An undo restore settles the origin again and returns the others to pending.
type ReplicaEdge = "settle" | "fail" | "retry" | "requeue" | "supersede" | "restore" | "restoreOrigin";
const REPLICA_EDGES: Record<ReplicaEdge, { from: ReplicaState[]; to: ReplicaState }> = {
  settle: { from: ["pending"], to: "settled" },
  fail: { from: ["pending"], to: "failed" },
  retry: { from: ["failed"], to: "pending" },
  requeue: { from: ["failed"], to: "pending" },
  supersede: { from: ["pending", "settled", "failed"], to: "superseded" },
  restore: { from: ["superseded"], to: "pending" },
  restoreOrigin: { from: ["superseded"], to: "settled" },
};

// The one replica write: moves the rows `where` selects along `edge`, setting the edge's other
// columns, and only from the edge's legal states. `join` names extra tables the condition reads.
async function moveReplicas(db: Db, edge: ReplicaEdge, change: { set: string; where: string; params: unknown[]; join?: string }): Promise<Replica[]> {
  const { from, to } = REPLICA_EDGES[edge];
  const n = change.params.length;
  const updated = await query<Replica>(db,
    `UPDATE replicas r SET state = $${n + 1}, ${change.set}${change.join ? ` FROM ${change.join}` : ""}
     WHERE r.state = ANY($${n + 2}::text[]) AND ${change.where} RETURNING r.*`, [...change.params, to, from]);
  if (to === "pending" && updated.length) wakeReplication();
  return updated;
}

export const isReady = (replicas: Replica[]): boolean => replicas.every((r) => r.state === "settled");

// On acknowledgement the origin is settled with settle_ms 0 and every other placed region pending.
export async function createReplicas(client: pg.PoolClient, versionId: string, placement: string[], ack: Date): Promise<void> {
  for (const [position, region] of placement.entries()) {
    const origin = position === 0;
    await client.query(
      `INSERT INTO replicas (version_id, region, position, role, state, settled_at, settle_ms, pending_since)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [versionId, region, position, origin ? "origin" : "replica", origin ? "settled" : "pending",
        origin ? ack : null, origin ? 0 : null, origin ? null : ack]);
  }
  wakeReplication();
}

// A newer version or a delete supersedes every replica; an in-flight copy never settles it, and a
// replica that had already settled keeps its settle time.
export async function supersedeReplicas(client: pg.PoolClient, versionId: string): Promise<void> {
  await moveReplicas(client, "supersede", {
    set: `claim = NULL, pending_since = NULL, settled_at = CASE WHEN r.state = 'settled' THEN r.settled_at END,
      settle_ms = CASE WHEN r.state = 'settled' THEN r.settle_ms END`,
    where: "r.version_id = $1", params: [versionId],
  });
}

// Undo restore: the origin settles at the undo second, every other replica returns to pending.
export async function restoreReplicas(client: pg.PoolClient, versionId: string, at: Date): Promise<void> {
  await moveReplicas(client, "restoreOrigin", {
    set: "settled_at = $2, settle_ms = 0, error = NULL", where: "r.version_id = $1 AND r.role = 'origin'", params: [versionId, at],
  });
  await moveReplicas(client, "restore", {
    set: "settled_at = NULL, settle_ms = NULL, error = NULL, claim = NULL, pending_since = $2",
    where: "r.version_id = $1 AND r.role = 'replica'", params: [versionId, at],
  });
}

// Manual retry: legal only from failed.
export async function retryReplica(client: pg.PoolClient, versionId: string, region: string): Promise<Replica> {
  const replica = await one<Replica>(client, "SELECT * FROM replicas WHERE version_id = $1 AND region = $2 FOR UPDATE", [versionId, region]);
  if (!replica) throw new ApiError("not_found");
  const [updated] = await moveReplicas(client, "retry", {
    set: "error = NULL, claim = NULL, pending_since = now()", where: "r.version_id = $1 AND r.region = $2", params: [versionId, region],
  });
  if (!updated) throw transition(replica.state, "pending");
  return updated;
}

// A region coming back online returns its region_offline failures of current versions to pending.
export async function requeueRegion(client: pg.PoolClient, region: string): Promise<void> {
  await moveReplicas(client, "requeue", {
    set: "error = NULL, claim = NULL, pending_since = now()", join: "versions v",
    where: "v.version_id = r.version_id AND v.current AND r.region = $1 AND r.error = 'region_offline'", params: [region],
  });
}

// Backlog figures: pending and failed replicas of current versions per region.
export async function regionBacklog(db: Db): Promise<Array<{ id: string; name: string; state: string; pending: number; failed: number; oldest_pending_ms: number | null }>> {
  return query(db,
    `SELECT g.id, g.name, g.state,
       count(*) FILTER (WHERE r.state = 'pending')::int AS pending,
       count(*) FILTER (WHERE r.state = 'failed')::int AS failed,
       (extract(epoch FROM now() - min(r.pending_since) FILTER (WHERE r.state = 'pending')) * 1000)::bigint AS oldest_pending_ms
     FROM regions g
     LEFT JOIN replicas r ON r.region = g.id AND r.state IN ('pending', 'failed')
       AND EXISTS (SELECT 1 FROM versions v WHERE v.version_id = r.version_id AND v.current)
     GROUP BY g.id, g.name, g.state, g.position ORDER BY g.position`);
}

// ---- The worker ----

interface ClaimedReplica {
  version_id: string;
  region: string;
  claim: string;
  bucket: string;
  workspace_id: string;
  origin: string;
  size: number;
  etag: string;
  part_sizes: number[] | null;
  wrapped_key: Buffer;
  key_generation: number;
  acknowledged_at: Date;
  region_state: string;
}

let wake: (() => void) | null = null;
function wakeReplication(): void {
  wake?.();
}

async function claimReplicas(): Promise<ClaimedReplica[]> {
  const claim = randomBytes(8).toString("hex");
  return query<ClaimedReplica>(pool,
    `WITH picked AS (
       SELECT r.version_id, r.region FROM replicas r
       WHERE r.state = 'pending' AND (r.claim IS NULL OR r.claimed_at < now() - interval '60 seconds')
         AND NOT EXISTS (SELECT 1 FROM replicas e WHERE e.version_id = r.version_id AND e.state = 'pending'
                           AND e.position < r.position AND (e.claim IS NULL OR e.claimed_at < now() - interval '60 seconds'))
       ORDER BY r.pending_since, r.position LIMIT 16 FOR UPDATE SKIP LOCKED)
     UPDATE replicas r SET claim = $1, claimed_at = now(), attempts = r.attempts + 1
     FROM picked p, versions v, buckets b, regions g
     WHERE r.version_id = p.version_id AND r.region = p.region AND v.version_id = r.version_id
       AND b.id = v.bucket_id AND g.id = r.region
     RETURNING r.version_id, r.region, r.claim, b.name AS bucket, b.workspace_id, b.placement[1] AS origin, v.size, v.etag,
       v.part_sizes, v.wrapped_key, v.key_generation, v.acknowledged_at, g.state AS region_state`, [claim]);
}

// Settles or fails a claimed replica only while it is still pending and its version current.
async function settleOrFail(replica: ClaimedReplica, state: "settled" | "failed", error: ReplicaError | null): Promise<boolean> {
  const changed = await moveReplicas(pool, state === "settled" ? "settle" : "fail", {
    set: `error = $4, claim = NULL, pending_since = NULL,
      settled_at = CASE WHEN $4::text IS NULL THEN now() END,
      settle_ms = CASE WHEN $4::text IS NULL THEN floor(extract(epoch FROM now() - v.acknowledged_at) * 1000)::bigint END`,
    join: "versions v",
    where: "r.version_id = $1 AND r.region = $2 AND r.claim = $3 AND v.version_id = r.version_id AND v.current",
    params: [replica.version_id, replica.region, replica.claim, error],
  });
  return changed.length > 0;
}

async function releaseReplicaClaim(replica: ClaimedReplica): Promise<void> {
  await pool.query("UPDATE replicas SET claim = NULL WHERE version_id = $1 AND region = $2 AND claim = $3",
    [replica.version_id, replica.region, replica.claim]);
}

// Copies one version to one region, reads the copy back, and settles the replica only when the copy
// reproduces the index size and ETag while the replica is still pending and its version current.
async function copyReplica(replica: ClaimedReplica): Promise<void> {
  const target = regionObjectKey(replica.region, replica.bucket, replica.version_id);
  if (replica.region_state === "offline") {
    await settleOrFail(replica, "failed", "region_offline");
    return;
  }
  try {
    await copyObject(regionObjectKey(replica.origin, replica.bucket, replica.version_id), target);
    const dataKey = await unwrapForWorkspace(pool, replica.workspace_id, replica);
    const plaintext = decryptStream(await getObject(target), dataKey, replica.part_sizes ?? [replica.size]);
    const measured = await measurePlaintext(plaintext, replica.part_sizes);
    const matches = measured.size === replica.size && measured.etag === replica.etag;
    const regionNow = await one<{ state: string }>(pool, "SELECT state FROM regions WHERE id = $1", [replica.region]);
    if (regionNow?.state === "offline") await settleOrFail(replica, "failed", "region_offline");
    else if (!(await settleOrFail(replica, matches ? "settled" : "failed", matches ? null : "etag_mismatch"))) await releaseReplicaClaim(replica);
  } catch (error) {
    if (error instanceof StorageUnavailable) await releaseReplicaClaim(replica);
    else await settleOrFail(replica, "failed", "copy_failed");
  }
  // Bytes from a copy that lands after its version was removed never become a replica.
  const stillKnown = await one(pool, "SELECT 1 FROM replicas WHERE version_id = $1 AND region = $2", [replica.version_id, replica.region]);
  if (!stillKnown) await deleteObject(target).catch(() => undefined);
}

export function startReplicationWorker(): void {
  let running = false;
  let again = false;
  const tick = async (): Promise<void> => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        const claimed = await claimReplicas();
        await Promise.all(claimed.map((replica) => copyReplica(replica).catch(() => releaseReplicaClaim(replica).catch(() => undefined))));
        if (claimed.length) again = true;
      } while (again);
    } catch {
      // Postgres or MinIO unavailable: the next tick retries.
    } finally {
      running = false;
    }
  };
  wake = () => void tick();
  setInterval(() => void tick(), 250).unref();
}
