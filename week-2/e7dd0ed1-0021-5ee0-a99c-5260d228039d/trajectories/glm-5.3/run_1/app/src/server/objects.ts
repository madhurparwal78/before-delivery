import { one, tx } from './db.js';
import { config } from './config.js';
import { versionId, md5Hex, opaqueId, encryptBytes, decryptBytes, wrapDataKey, workspaceKey, unwrapDataKey } from './crypto.js';
import { putRegionCiphertext, deleteRegionCiphertext, getRegionCiphertext } from './storage.js';
import { fail, invalidTransition, notFound, storageUnavailable } from './errors.js';
import { randomBytes } from 'node:crypto';

export interface BucketRow { name: string; workspace_slug: string; placement: string[]; object_count: number; stored_bytes: string }

export async function bucketByName(name: string): Promise<BucketRow | null> {
  const r = await one<BucketRow>(
    `SELECT name, workspace_slug, placement, object_count, stored_bytes::text FROM buckets WHERE name = $1`, [name]
  );
  return r;
}

export interface VersionRow {
  version_id: string; bucket_name: string; key: string; etag: string; size: string;
  content_type: string; metadata: Record<string, string>; tags: Record<string, string>;
  checksum_algo: string | null; checksum_value: string | null; state: string;
  acknowledged_at: Date; noncurrent_since: Date | null; retain_until: Date | null;
  legal_hold: boolean; wrapped_key: string; key_generation: number;
  part_count: number | null; part_sizes: string[] | null;
}

export async function currentVersion(bucket: string, key: string): Promise<VersionRow | null> {
  return one<VersionRow>(
    `SELECT version_id, bucket_name, key, etag, size::text AS size, content_type, metadata, tags,
            checksum_algo, checksum_value, state, acknowledged_at, noncurrent_since, retain_until, legal_hold,
            wrapped_key, key_generation, part_count, part_sizes::text[] AS part_sizes
     FROM versions WHERE bucket_name = $1 AND key = $2 AND state = 'current'`, [bucket, key]
  );
}

export async function versionById(vid: string): Promise<VersionRow | null> {
  return one<VersionRow>(
    `SELECT version_id, bucket_name, key, etag, size::text AS size, content_type, metadata, tags,
            checksum_algo, checksum_value, state, acknowledged_at, noncurrent_since, retain_until, legal_hold,
            wrapped_key, key_generation, part_count, part_sizes::text[] AS part_sizes
     FROM versions WHERE version_id = $1`, [vid]
  );
}

export function isLocked(v: { retain_until: Date | null; legal_hold: boolean }, now = new Date()): boolean {
  if (v.legal_hold) return true;
  if (v.retain_until && v.retain_until.getTime() > now.getTime()) return true;
  return false;
}

export interface WriteInput {
  bucket: string; key: string; bytes: Buffer; contentType: string;
  metadata: Record<string, string>; tags: Record<string, string>;
  checksumAlgo?: string | null; checksumValue?: string | null;
  partCount?: number | null; partSizes?: number[] | null; partMd5s?: string[] | null;
  ciphertext?: Buffer | null; dataKey?: Buffer | null;
}

/**
 * The single place where a version is acknowledged: prior current becomes
 * noncurrent, bucket counters change, replicas are created, events emitted.
 */
export async function acknowledgeWrite(input: WriteInput): Promise<VersionRow> {
  const bucket = await bucketByName(input.bucket);
  if (!bucket) throw notFound();
  const ws = bucket.workspace_slug;
  const now = new Date();
  const vid = versionId();
  const etag = input.partCount && input.partMd5s
    ? '"' + md5Hex(Buffer.concat(input.partMd5s.map(m => Buffer.from(m, 'hex')))) + '-' + input.partCount + '"'
    : '"' + md5Hex(input.bytes) + '"';
  const dataKey = input.dataKey ?? randomBytes(32);
  // Wrap under the workspace's current key generation.
  const wsRow = await one<{ key_generation: number }>(`SELECT key_generation FROM workspaces WHERE slug = $1`, [ws]);
  const generation = wsRow?.key_generation ?? 1;
  const wk = workspaceKey(config.secretKey, ws, generation);
  const wrapped = wrapDataKey(wk, dataKey);
  const ciphertext = input.ciphertext ?? encryptBytes(dataKey, input.bytes);
  const placed = bucket.placement.length;

  await tx(async client => {
    await client.query(`UPDATE versions SET state = 'noncurrent', noncurrent_since = $1
      WHERE bucket_name = $2 AND key = $3 AND state = 'current'`, [now, input.bucket, input.key]);
    await client.query(
      `INSERT INTO versions (version_id, bucket_name, key, etag, size, content_type, metadata, tags,
        checksum_algo, checksum_value, state, acknowledged_at, wrapped_key, key_generation, part_count, part_sizes)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,'current',$11,$12,$13,$14,$15)`,
      [vid, input.bucket, input.key, etag, input.bytes.length, input.contentType,
        JSON.stringify(input.metadata), JSON.stringify(input.tags),
        input.checksumAlgo ?? null, input.checksumValue ?? null, now, wrapped, generation,
        input.partCount ?? null, input.partSizes ?? null]
    );
    let position = 0;
    for (const region of bucket.placement) {
      const isOrigin = position === 0;
      await client.query(
        `INSERT INTO replicas (version_id, region, position, role, state, attempts, settled_at, settle_ms, error)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL)`,
        [vid, region, position, isOrigin ? 'origin' : 'replica', isOrigin ? 'settled' : 'pending', 0, isOrigin ? now : null, isOrigin ? 0 : null]
      );
      position++;
    }
    const existed = await client.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM versions WHERE bucket_name = $1 AND key = $2 AND version_id <> $3 AND state <> 'removed'`,
      [input.bucket, input.key, vid]
    );
    const newKey = existed.rows[0].c === '0';
    await client.query(
      `UPDATE buckets SET object_count = object_count + $1, stored_bytes = stored_bytes + $2 WHERE name = $3`,
      [newKey ? 1 : 0, BigInt(input.bytes.length) * BigInt(placed), input.bucket]
    );
    await client.query(`INSERT INTO storage_events (bucket_name, at, stored_bytes)
      SELECT $1, $2, stored_bytes FROM buckets WHERE name = $1
      ON CONFLICT (bucket_name, at) DO UPDATE SET stored_bytes = EXCLUDED.stored_bytes`, [input.bucket, now]);
    await emitEvent(client, ws, 'object.created', input.bucket, input.key, vid, etag, input.bytes.length, null);
    await recordUsage(client, ws, input.bucket, 'request-units', 1, now);
  });

  const created = await versionById(vid);
  if (!created) throw fail(500, 'internal_error', 'Version was not stored.');
  for (const region of bucket.placement) {
    await putRegionCiphertext(region, input.bucket, vid, ciphertext);
  }
  return created;
}

/** Emits an event row and one delivery per matching active endpoint. */
export async function emitEvent(
  client: { query: (sql: string, p: unknown[]) => Promise<unknown> },
  ws: string, type: string, bucket: string, key: string, vid: string, etag: string, size: number, reason: string | null,
): Promise<void> {
  const eventId = opaqueId('evt', 12);
  await client.query(
    `INSERT INTO webhook_events (id, workspace_slug, type, bucket, key, version_id, etag, size, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [eventId, ws, type, bucket, key, vid, etag, size, reason]
  );
  const endpoints = (await (client.query(
    `SELECT id FROM webhook_endpoints WHERE workspace_slug = $1 AND state = 'active' AND $2 = ANY(events)
       AND (buckets IS NULL OR $3 = ANY(buckets))`,
    [ws, type, bucket]
  ) as Promise<{ rows: Array<{ id: string }> }>)).rows;
  for (const ep of endpoints) {
    const seq = (await (client.query(
      `SELECT COALESCE(MAX(sequence),0) + 1 AS s FROM webhook_deliveries WHERE endpoint_id = $1`, [ep.id]
    ) as Promise<{ rows: Array<{ s: string }> }>)).rows[0].s;
    await client.query(
      `INSERT INTO webhook_deliveries (id, endpoint_id, event_id, workspace_slug, sequence, state, next_attempt_at)
       VALUES ($1,$2,$3,$4,$5,'pending', now())`,
      [opaqueId('d', 10), ep.id, eventId, ws, seq]
    );
  }
}

/** Adds to a usage row within the current window, creating it when missing. */
export async function recordUsage(
  client: { query: (sql: string, p: unknown[]) => Promise<unknown> },
  ws: string, bucket: string, unit: string, amount: number | string, now: Date,
): Promise<void> {
  if (unit === 'storage-gb-hours') {
    await client.query(
      `INSERT INTO usage_rows (workspace_slug, bucket_name, unit, window_start, window_end, amount, tracking_id, billing_state)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'open')
       ON CONFLICT (workspace_slug, bucket_name, unit, window_start) DO UPDATE SET amount = $6`,
      [ws, bucket, unit, now, now, String(amount), trackingId(ws, bucket, unit, now)]
    );
    return;
  }
  const hourStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours()));
  await client.query(
    `INSERT INTO usage_rows (workspace_slug, bucket_name, unit, window_start, window_end, amount, tracking_id, billing_state)
     VALUES ($1,$2,$3,$4,$5,$6::numeric,$7,'open')
     ON CONFLICT (workspace_slug, bucket_name, unit, window_start)
     DO UPDATE SET amount = (usage_rows.amount::numeric + $6::numeric)::text`,
    [ws, bucket, unit, hourStart, new Date(hourStart.getTime() + 3_600_000), amount, trackingId(ws, bucket, unit, hourStart)]
  );
}

export function trackingId(ws: string, bucket: string, unit: string, windowStart: Date): string {
  const t = windowStart.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `fs-${ws}-${bucket}-${unit}-${t}`;
}

/** Plain delete: ends the current version, supersedes replicas, revokes links. */
export async function plainDelete(bucket: string, key: string, opts: { reason?: string; ws: string; emitEvent?: boolean; recordUnit?: boolean }): Promise<VersionRow | null> {
  const v = await currentVersion(bucket, key);
  if (!v) return null;
  const now = new Date();
  const bucketRow = await bucketByName(bucket);
  if (!bucketRow) throw notFound();
  await tx(async client => {
    await client.query(`UPDATE versions SET state = 'noncurrent', noncurrent_since = $1 WHERE version_id = $2`,
      [now, v.version_id]);
    await client.query(`UPDATE replicas SET state = 'superseded', settled_at = NULL, settle_ms = NULL, error = NULL WHERE version_id = $1`,
      [v.version_id]);
    await client.query(`UPDATE share_links SET state = 'revoked' WHERE version_id = $1 AND state = 'active'`, [v.version_id]);
    await client.query(`UPDATE buckets SET object_count = object_count - 1 WHERE name = $1`, [bucket]);
    await client.query(`INSERT INTO storage_events (bucket_name, at, stored_bytes)
      SELECT $1, $2, stored_bytes FROM buckets WHERE name = $1
      ON CONFLICT (bucket_name, at) DO UPDATE SET stored_bytes = EXCLUDED.stored_bytes`, [bucket, now]);
    if (opts.emitEvent !== false) {
      await emitEvent(client, opts.ws, 'object.deleted', bucket, key, v.version_id, v.etag, Number(v.size), null);
    }
    if (opts.recordUnit !== false) {
      await recordUsage(client, opts.ws, bucket, 'request-units', 1, now);
    }
  });
  return v;
}

/** Permanent delete / lifecycle expiry of a version, in one change. */
export async function removeVersion(v: VersionRow, reason: 'request' | 'lifecycle', recordUnit: boolean): Promise<void> {
  const bucketRow = await bucketByName(v.bucket_name);
  if (!bucketRow) throw notFound();
  const ws = bucketRow.workspace_slug;
  const now = new Date();
  const sizeNum = Number(v.size);
  const placed = bucketRow.placement.length;
  await tx(async client => {
    await client.query(`UPDATE versions SET state = 'removed', expired_at = $1 WHERE version_id = $2`, [now, v.version_id]);
    await client.query(`DELETE FROM replicas WHERE version_id = $1`, [v.version_id]);
    await client.query(`UPDATE share_links SET state = 'revoked' WHERE version_id = $1 AND state = 'active'`, [v.version_id]);
    await client.query(`UPDATE buckets SET stored_bytes = stored_bytes - $1 WHERE name = $2`,
      [BigInt(sizeNum) * BigInt(placed), v.bucket_name]);
    await client.query(`INSERT INTO storage_events (bucket_name, at, stored_bytes)
      SELECT $1, $2, stored_bytes FROM buckets WHERE name = $1
      ON CONFLICT (bucket_name, at) DO UPDATE SET stored_bytes = EXCLUDED.stored_bytes`, [v.bucket_name, now]);
    await emitEvent(client, ws, 'version.removed', v.bucket_name, v.key, v.version_id, v.etag, sizeNum, reason);
    if (recordUnit) {
      await recordUsage(client, ws, v.bucket_name, 'request-units', 1, now);
    }
  });
  for (const region of bucketRow.placement) {
    await deleteRegionCiphertext(region, v.bucket_name, v.version_id);
  }
}

/** Undo restore: makes the batch's version current again. */
export async function restoreVersion(v: VersionRow, bucket: string, ws: string): Promise<void> {
  const bucketRow = await bucketByName(bucket);
  if (!bucketRow) throw notFound();
  const now = new Date();
  await tx(async client => {
    const cur = await client.query(`SELECT version_id FROM versions WHERE bucket_name = $1 AND key = $2 AND state = 'current'`,
      [bucket, v.key]);
    if (cur.rows.length > 0) throw invalidTransition('noncurrent', 'current');
    await client.query(`UPDATE versions SET state = 'current', noncurrent_since = NULL, acknowledged_at = $1 WHERE version_id = $2`,
      [now, v.version_id]);
    await client.query(
      `UPDATE replicas SET state = CASE WHEN role = 'origin' THEN 'settled' ELSE 'pending' END,
        settled_at = CASE WHEN role = 'origin' THEN $1::timestamptz ELSE NULL END,
        settle_ms = CASE WHEN role = 'origin' THEN 0 ELSE NULL END,
        error = NULL
       WHERE version_id = $2`, [now, v.version_id]);
    await client.query(`UPDATE buckets SET object_count = object_count + 1 WHERE name = $1`, [bucket]);
    await client.query(`INSERT INTO storage_events (bucket_name, at, stored_bytes)
      SELECT $1, $2, stored_bytes FROM buckets WHERE name = $1
      ON CONFLICT (bucket_name, at) DO UPDATE SET stored_bytes = EXCLUDED.stored_bytes`, [bucket, now]);
    await emitEvent(client, ws, 'object.restored', bucket, v.key, v.version_id, v.etag, Number(v.size), null);
  });
}

export async function loadPlaintext(v: VersionRow): Promise<Buffer> {
  const bucketRow = await bucketByName(v.bucket_name);
  if (!bucketRow) throw notFound();
  const origin = bucketRow.placement[0];
  const cipher = await getRegionCiphertext(origin, v.bucket_name, v.version_id);
  if (!cipher) throw storageUnavailable();
  const wk = workspaceKey(config.secretKey, bucketRow.workspace_slug, v.key_generation);
  const dataKey = unwrapDataKey(wk, v.wrapped_key);
  if (!dataKey) throw fail(500, 'internal_error', 'The data key could not be unwrapped.');
  const out = decryptBytes(dataKey, cipher);
  if (!out) throw fail(500, 'internal_error', 'The stored bytes could not be decrypted.');
  return out;
}
