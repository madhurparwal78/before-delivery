import { one, rows, tx } from './db.js';
import { config } from './config.js';
import { decryptBytes, md5Hex, workspaceKey, unwrapDataKey } from './crypto.js';
import { putRegionCiphertext, getRegionCiphertext } from './storage.js';

interface PendingReplica {
  version_id: string; region: string; position: number; bucket_name: string; key: string;
  etag: string; size: string; wrapped_key: string; key_generation: number;
  acknowledged_at: Date; part_count: number | null; part_sizes: string[] | null;
  origin: string;
}

/** One replication pass: copies each pending replica of a current version, in placement order. */
export async function replicateOnce(): Promise<void> {
  const pending = await rows<PendingReplica>(
    `SELECT r.version_id, r.region, r.position, v.bucket_name, v.key, v.etag, v.size::text AS size,
            v.wrapped_key, v.key_generation, v.acknowledged_at, v.part_count, v.part_sizes::text[] AS part_sizes,
            (SELECT region FROM replicas WHERE version_id = r.version_id AND role = 'origin' LIMIT 1) AS origin
     FROM replicas r JOIN versions v ON v.version_id = r.version_id
     WHERE r.state = 'pending' AND r.role = 'replica' AND v.state = 'current'
     ORDER BY v.acknowledged_at ASC, r.position ASC LIMIT 20`
  );
  for (const p of pending) {
    await copyOne(p);
  }
}

async function copyOne(p: PendingReplica): Promise<void> {
  const regionRow = await one<{ state: string }>(`SELECT state FROM regions WHERE id = $1`, [p.region]);
  const now = new Date();
  if (!regionRow || regionRow.state === 'offline') {
    await tx(async client => {
      const cur = await client.query<{ state: string; version_state: string }>(
        `SELECT r.state, v.state AS version_state FROM replicas r JOIN versions v ON v.version_id = r.version_id
         WHERE r.version_id = $1 AND r.region = $2`, [p.version_id, p.region]
      );
      const r = cur.rows[0];
      if (!r || r.state !== 'pending' || r.version_state !== 'current') return;
      await client.query(
        `UPDATE replicas SET state = 'failed', error = 'region_offline', attempts = attempts + 1
         WHERE version_id = $1 AND region = $2`, [p.version_id, p.region]
      );
    });
    return;
  }
  try {
    const cipher = await getRegionCiphertext(p.origin, p.bucket_name, p.version_id);
    if (!cipher) return; // origin copy not ready yet; stays pending
    await putRegionCiphertext(p.region, p.bucket_name, p.version_id, cipher);
    const copy = await getRegionCiphertext(p.region, p.bucket_name, p.version_id);
    if (!copy) { await markFailed(p, 'copy_failed', now); return; }
    // Decrypt and verify against the index ETag while still current.
    const bucketRow = await one<{ workspace_slug: string }>(`SELECT workspace_slug FROM buckets WHERE name = $1`, [p.bucket_name]);
    if (!bucketRow) return;
    const wk = workspaceKey(config.secretKey, bucketRow.workspace_slug, p.key_generation);
    const dataKey = unwrapDataKey(wk, p.wrapped_key);
    if (!dataKey) { await markFailed(p, 'copy_failed', now); return; }
    const plain = decryptBytes(dataKey, copy);
    if (!plain || plain.length !== Number(p.size)) { await markFailed(p, 'etag_mismatch', now); return; }
    const etag = '"' + md5Hex(plain) + '"';
    if (etag !== p.etag) { await markFailed(p, 'etag_mismatch', now); return; }
    const settledAt = new Date();
    await tx(async client => {
      const cur = await client.query<{ state: string; version_state: string; acknowledged_at: Date }>(
        `SELECT r.state, v.state AS version_state, v.acknowledged_at FROM replicas r JOIN versions v ON v.version_id = r.version_id
         WHERE r.version_id = $1 AND r.region = $2`, [p.version_id, p.region]
      );
      const r = cur.rows[0];
      if (!r || r.state !== 'pending' || r.version_state !== 'current') return;
      const settleMs = Math.max(0, Math.round((settledAt.getTime() - r.acknowledged_at.getTime())));
      await client.query(
        `UPDATE replicas SET state = 'settled', settled_at = $1, settle_ms = $2, error = NULL, attempts = attempts + 1
         WHERE version_id = $3 AND region = $4`, [settledAt, settleMs, p.version_id, p.region]
      );
    });
  } catch {
    await markFailed(p, 'copy_failed', now);
  }
}

async function markFailed(p: PendingReplica, error: string, now: Date): Promise<void> {
  void now;
  await tx(async client => {
    const cur = await client.query<{ state: string; version_state: string }>(
      `SELECT r.state, v.state AS version_state FROM replicas r JOIN versions v ON v.version_id = r.version_id
       WHERE r.version_id = $1 AND r.region = $2`, [p.version_id, p.region]
    );
    const r = cur.rows[0];
    if (!r || r.state !== 'pending' || r.version_state !== 'current') return;
    await client.query(
      `UPDATE replicas SET state = 'failed', error = $1, attempts = attempts + 1 WHERE version_id = $2 AND region = $3`,
      [error, p.version_id, p.region]
    );
  });
}

/** Brings a region online: failed region_offline replicas of current versions return to pending. */
export async function regionCameOnline(regionId: string): Promise<void> {
  await tx(async client => {
    await client.query(
      `UPDATE replicas SET state = 'pending', error = NULL
       WHERE region = $1 AND state = 'failed' AND error = 'region_offline'
         AND version_id IN (SELECT version_id FROM versions WHERE state = 'current')`,
      [regionId]
    );
  });
}

/** The replication loop; settles new replicas within seconds of acknowledgement. */
export async function startReplicationLoop(): Promise<void> {
  for (;;) {
    await new Promise(r => setTimeout(r, 1000));
    try { await replicateOnce(); } catch { /* retried next tick */ }
  }
}
