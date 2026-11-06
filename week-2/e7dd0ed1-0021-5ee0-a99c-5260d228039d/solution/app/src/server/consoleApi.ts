// The console's JSON API for buckets, objects, versions, replicas, bulk delete and search
// (brief: API, Buckets and lifecycle rules; Objects (console API)).
import { createHash } from "node:crypto";
import { authorize, membership, type Membership } from "./access.js";
import { one, pool, query, row, tx } from "./db.js";
import { downloadHeaders, openVersion, servedType, streamBody } from "./downloads.js";
import { ApiError, invalid, transition } from "./errors.js";
import {
  fieldErrors, header, isoOrNull, isoSecond, parseJsonObject, readBody, readJson, sendJson, sendNoContent, type Ctx, type JsonObject,
} from "./http.js";
import { md5Etag } from "./integrity.js";
import {
  bucketNameError, DELETE_ENTRIES_MAX, IDEMPOTENCY_KEY_MESSAGE, idempotencyKeyAllowed, judgeContent, keyAllowed, LIFECYCLE_MESSAGES,
  lifecycleAllowed, METADATA_MESSAGE, metadataAllowed, parseTags, placementError, RETENTION_DAYS_MAX, RETENTION_MESSAGE,
  SINGLE_UPLOAD_MAX, TAGS_MESSAGE, characters,
} from "./limits.js";
import { versionFromQuery } from "./links.js";
import {
  decodeCursor, DEFAULT_PAGE, encodeCursor, FilterError, listEntries, pageLimitAllowed, parseTagFilter, searchKeys,
  validateDelimiter, validatePrefix, type TagFilter,
} from "./listing.js";
import {
  commitVersion, currentVersion, newVersionId, parseCondition, permanentDelete, plainDelete, QuotaRefused, quotaError,
  releaseReservation, reserve, restoreVersion, workspaceBucket, checkCondition, type Bucket, type Version,
} from "./objects.js";
import { isReady, replicaJson, replicasOf, retryReplica } from "./replication.js";
import { REGION_IDS } from "./schema.js";
import { newId } from "./secrets.js";
import { deleteObject, putObject, regionObjectKey } from "./storage.js";
import { encryptPart, newDataKey } from "./encryption.js";
import { appendAudit } from "./audit.js";
import { checkThresholds, meterRead } from "./usage.js";
import { config } from "./config.js";
import { isLocked, retentionInForce } from "../shared/locks.js";

const bucketJson = (b: Bucket): Record<string, unknown> => ({
  name: b.name, placement: b.placement, created_at: isoSecond(b.created_at), object_count: b.object_count, stored_bytes: b.stored_bytes,
});

async function bucketOf(ctx: Ctx): Promise<{ m: Membership; bucket: Bucket }> {
  const m = await membership(ctx, ctx.params.ws ?? "");
  return { m, bucket: await workspaceBucket(pool, m.workspace.id, ctx.params.bucket ?? "") };
}

// ---- Buckets and lifecycle rules ----

export async function listBuckets(ctx: Ctx): Promise<void> {
  const m = await membership(ctx, ctx.params.ws ?? "");
  authorize(m, "read");
  const rows = await query<Bucket>(pool, `SELECT * FROM buckets WHERE workspace_id = $1 ORDER BY name COLLATE "C"`, [m.workspace.id]);
  sendJson(ctx, 200, { buckets: rows.map(bucketJson) });
}

export async function getBucket(ctx: Ctx): Promise<void> {
  const { m, bucket } = await bucketOf(ctx);
  authorize(m, "read");
  sendJson(ctx, 200, bucketJson(bucket));
}

export async function createBucket(ctx: Ctx): Promise<void> {
  const m = await membership(ctx, ctx.params.ws ?? "");
  authorize(m, "write", true);
  const body = await readJson(ctx);
  const errors = fieldErrors(body, ["name", "placement"], ["name", "placement"]);
  const nameError = errors.name ? null : bucketNameError(body.name);
  if (!errors.name && nameError) errors.name = nameError;
  if (!errors.placement) {
    const placementProblem = placementError(body.placement, REGION_IDS);
    if (placementProblem) errors.placement = placementProblem;
  }
  if (!nameError && typeof body.name === "string" && await one(pool, "SELECT 1 FROM buckets WHERE name = $1", [body.name])) {
    throw new ApiError("bucket_name_taken");
  }
  if (Object.keys(errors).length) throw invalid(errors);
  try {
    const bucket = await row<Bucket>(pool,
      "INSERT INTO buckets (workspace_id, name, placement, created_at) VALUES ($1, $2, $3, now()) RETURNING *",
      [m.workspace.id, body.name, body.placement]);
    sendJson(ctx, 201, bucketJson(bucket));
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new ApiError("bucket_name_taken");
    throw error;
  }
}

const lifecycleJson = (b: Bucket): Record<string, unknown> => ({
  noncurrent_days: b.noncurrent_days, keep_newest_noncurrent: b.keep_newest_noncurrent,
  abort_multipart_days: b.abort_multipart_days, updated_at: isoOrNull(b.lifecycle_updated_at),
});

export async function getLifecycle(ctx: Ctx): Promise<void> {
  const { m, bucket } = await bucketOf(ctx);
  authorize(m, "read");
  sendJson(ctx, 200, lifecycleJson(bucket));
}

export async function putLifecycle(ctx: Ctx): Promise<void> {
  const { m, bucket } = await bucketOf(ctx);
  authorize(m, "write");
  const body = await readJson(ctx);
  const fields = ["noncurrent_days", "keep_newest_noncurrent", "abort_multipart_days"] as const;
  const errors = fieldErrors(body, fields, fields);
  for (const field of fields) {
    if (!errors[field] && !lifecycleAllowed[field](body[field])) errors[field] = LIFECYCLE_MESSAGES[field];
  }
  if (Object.keys(errors).length) throw invalid(errors);
  const saved = await one<Bucket>(pool,
    `UPDATE buckets SET noncurrent_days = $2, keep_newest_noncurrent = $3, abort_multipart_days = $4,
       lifecycle_updated_at = date_trunc('second', now()) WHERE id = $1 RETURNING *`,
    [bucket.id, body.noncurrent_days, body.keep_newest_noncurrent, body.abort_multipart_days]);
  if (!saved) throw new ApiError("not_found");
  sendJson(ctx, 200, lifecycleJson(saved));
}

// ---- Listing and search ----

async function replicaCounts(versionIds: string[]): Promise<Map<string, { settled: number; total: number }>> {
  const rows = await query<{ version_id: string; settled: number; total: number }>(pool,
    `SELECT version_id, count(*) FILTER (WHERE state = 'settled')::int AS settled, count(*)::int AS total
     FROM replicas WHERE version_id = ANY($1) GROUP BY version_id`, [versionIds]);
  return new Map(rows.map((r) => [r.version_id, { settled: r.settled, total: r.total }]));
}

export async function listObjects(ctx: Ctx): Promise<void> {
  const { m, bucket } = await bucketOf(ctx);
  authorize(m, "read");
  const errors: Record<string, string> = {};
  const limitText = ctx.query.get("limit");
  const limit = limitText === null || limitText === "" ? DEFAULT_PAGE : Number(limitText);
  if (!pageLimitAllowed(limit)) errors.limit = "Show 1 to 1,000 entries per page.";
  const prefix = ctx.query.get("prefix") ?? "";
  if (!validatePrefix(prefix)) errors.prefix = "Prefixes are limited to 1,024 bytes.";
  const delimiter = ctx.query.get("delimiter") ?? "";
  if (!validateDelimiter(delimiter)) errors.delimiter = "The delimiter is empty or exactly one character.";
  let filter: TagFilter = { source: "", node: null };
  try {
    filter = parseTagFilter(ctx.query.get("tag_filter") ?? "");
  } catch (error) {
    if (!(error instanceof FilterError)) throw error;
    errors.tag_filter = error.message;
  }
  const scope = { bucketId: bucket.id, prefix, delimiter, filter: filter.source };
  const cursor = ctx.query.get("cursor");
  let from = null;
  if (cursor) {
    try {
      from = decodeCursor(cursor, scope);
    } catch {
      errors.cursor = "This page link is no longer valid.";
    }
  }
  if (Object.keys(errors).length) throw invalid(errors);
  const result = await listEntries(pool, { bucketId: bucket.id, prefix, delimiter, filter, from, limit });
  const versions = result.entries.flatMap((e) => (e.kind === "object" ? [e.version] : []));
  const counts = await replicaCounts(versions.map((v) => v.version_id));
  sendJson(ctx, 200, {
    items: versions.map((v) => ({
      key: v.key, version_id: v.version_id, size: v.size, etag: v.etag, content_type: v.content_type,
      last_modified: isoSecond(v.last_modified), tags: v.tags,
      replicas_settled: counts.get(v.version_id)?.settled ?? 0, replicas_total: counts.get(v.version_id)?.total ?? 0,
    })),
    common_prefixes: result.entries.flatMap((e) => (e.kind === "prefix" ? [e.prefix] : [])),
    next_cursor: result.next ? encodeCursor(scope, result.next) : null,
    truncated: result.truncated,
  });
}

export async function search(ctx: Ctx): Promise<void> {
  const m = await membership(ctx, ctx.params.ws ?? "");
  authorize(m, "read");
  const q = ctx.query.get("q") ?? "";
  if (characters(q) < 1 || characters(q) > 128) throw invalid({ q: "Search for 1 to 128 characters." });
  const result = await searchKeys(pool, m.workspace.id, q);
  sendJson(ctx, 200, {
    items: result.items.map((i) => ({ bucket: i.bucket, key: i.key, size: i.size, last_modified: isoSecond(i.last_modified) })),
    truncated: result.truncated,
  });
}

// ---- Objects ----

function versionJson(bucket: Bucket, v: Version): Record<string, unknown> {
  return { bucket: bucket.name, key: v.key, version_id: v.version_id, etag: v.etag, size: v.size, content_type: v.content_type,
    last_modified: isoSecond(v.last_modified) };
}

// Header values arrive as latin1 from Node; user metadata is UTF-8.
const utf8Header = (value: string): string => Buffer.from(value, "latin1").toString("utf8");

export function userMetadata(ctx: Ctx): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const [name, value] of Object.entries(ctx.req.headers)) {
    if (name.startsWith("x-amz-meta-") && value !== undefined) {
      metadata[name.slice("x-amz-meta-".length)] = utf8Header(Array.isArray(value) ? value.join(",") : value);
    }
  }
  return metadata;
}

interface IdempotencyRecord {
  endpoint: string;
  bucket: string;
  object_key: string;
  body_sha256: string;
  status: number;
  response: JsonObject;
}

const sha256 = (data: Buffer): string => createHash("sha256").update(data).digest("hex");

// A stored completed key answers its stored response for the same request and 409 for any other.
async function replayIfKnown(ctx: Ctx, m: Membership, idemKey: string | undefined, endpoint: string, bucket: string,
                             objectKey: string, body: Buffer): Promise<boolean> {
  if (!idemKey || !idempotencyKeyAllowed(idemKey)) return false;
  const record = await one<IdempotencyRecord>(pool,
    `SELECT * FROM idempotency_records WHERE workspace_id = $1 AND idem_key = $2
       AND created_at > now() - make_interval(secs => $3)`, [m.workspace.id, idemKey, config.idempotencyTtlSeconds]);
  if (!record) return false;
  if (record.endpoint !== endpoint || record.bucket !== bucket || record.object_key !== objectKey || record.body_sha256 !== sha256(body)) {
    throw new ApiError("idempotency_key_reused");
  }
  sendJson(ctx, record.status, record.response, { "Idempotent-Replayed": "true" });
  return true;
}

async function rememberIdempotent(m: Membership, idemKey: string | undefined, endpoint: string, bucket: string, objectKey: string,
                                  body: Buffer, status: number, response: unknown): Promise<void> {
  if (!idemKey) return;
  await pool.query(
    `INSERT INTO idempotency_records (workspace_id, idem_key, endpoint, bucket, object_key, body_sha256, status, response, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (workspace_id, idem_key) DO UPDATE SET endpoint = EXCLUDED.endpoint, bucket = EXCLUDED.bucket,
       object_key = EXCLUDED.object_key, body_sha256 = EXCLUDED.body_sha256, status = EXCLUDED.status,
       response = EXCLUDED.response, created_at = EXCLUDED.created_at
     WHERE idempotency_records.created_at <= now() - make_interval(secs => $9)`,
    [m.workspace.id, idemKey, endpoint, bucket, objectKey, sha256(body), status, JSON.stringify(response), config.idempotencyTtlSeconds]);
}

export async function uploadObject(ctx: Ctx): Promise<void> {
  const { m, bucket } = await bucketOf(ctx);
  authorize(m, "write", true);
  const key = ctx.query.get("key") ?? "";
  const idemKey = header(ctx, "idempotency-key");
  const declaredText = header(ctx, "x-upload-size");
  const declared = declaredText !== undefined && /^\d{1,15}$/.test(declaredText) ? Number(declaredText) : null;
  const contentLength = Number(header(ctx, "content-length") ?? "0");
  // A replay is answered before any state, precondition or validation check.
  if (idemKey && idempotencyKeyAllowed(idemKey) && await one(pool,
      `SELECT 1 FROM idempotency_records WHERE workspace_id = $1 AND idem_key = $2
         AND created_at > now() - make_interval(secs => $3)`, [m.workspace.id, idemKey, config.idempotencyTtlSeconds])) {
    const body = await readBody(ctx, SINGLE_UPLOAD_MAX);
    if (body && await replayIfKnown(ctx, m, idemKey, "upload", bucket.name, key, body)) return;
    if (!body) throw new ApiError("payload_too_large");
  }
  const condition = parseCondition(header(ctx, "if-match"), header(ctx, "if-none-match"));
  checkCondition(await currentVersion(pool, bucket.id, key), condition);
  if ((declared ?? 0) > SINGLE_UPLOAD_MAX || contentLength > SINGLE_UPLOAD_MAX) throw new ApiError("payload_too_large");
  const errors: Record<string, string> = {};
  if (declared === null) errors.size = "Send X-Upload-Size with the file's size in bytes.";
  if (!keyAllowed(key)) errors.key = "This key can't be stored.";
  const metadata = userMetadata(ctx);
  if (!metadataAllowed(metadata)) errors.metadata = METADATA_MESSAGE;
  const tags = parseTags(header(ctx, "x-amz-tagging"));
  if (!tags) errors.tags = TAGS_MESSAGE;
  if (idemKey !== undefined && !idempotencyKeyAllowed(idemKey)) errors.idempotency_key = IDEMPOTENCY_KEY_MESSAGE;
  if (Object.keys(errors).length) throw invalid(errors);
  const size = declared ?? 0;
  let reservation: number;
  try {
    reservation = await reserve(m.workspace.id, m.workspace.plan_id, size * bucket.placement.length);
  } catch (error) {
    if (error instanceof QuotaRefused) throw quotaError(error);
    throw error;
  }
  const origin = bucket.placement[0] ?? "";
  const versionId = newVersionId();
  const target = regionObjectKey(origin, bucket.name, versionId);
  let stored = false;
  try {
    const region = await one<{ state: string }>(pool, "SELECT state FROM regions WHERE id = $1", [origin]);
    if (region?.state === "offline") throw new ApiError("region_offline");
    const data = await readBody(ctx, SINGLE_UPLOAD_MAX);
    if (data === null) throw new ApiError("payload_too_large");
    if (data.length !== size) {
      throw invalid({ size: `Declared size ${size} bytes does not match ${data.length} bytes received.` });
    }
    const verdict = judgeContent(data, header(ctx, "content-type"));
    if ("refused" in verdict) throw invalid({ content: "SVG files with scripts are not accepted." });
    const dataKey = newDataKey();
    await putObject(target, encryptPart(dataKey, data));
    stored = true;
    const version = await tx((client) => commitVersion(client, {
      bucket, key, versionId, size, etag: md5Etag(data), contentType: verdict.contentType, metadata, tags: tags ?? {},
      checksum: null, partSizes: null, dataKey, condition, reservationIds: [reservation], seeded: false,
    }));
    const replicas = await replicasOf(pool, version.version_id);
    const response = { ...versionJson(bucket, version), replicas: replicas.map(replicaJson) };
    await rememberIdempotent(m, idemKey, "upload", bucket.name, key, data, 201, response);
    ctx.now = new Date();
    sendJson(ctx, 201, response);
    void checkThresholds(m.workspace.id).catch(() => undefined);
  } catch (error) {
    await releaseReservation(reservation).catch(() => undefined);
    if (stored) await deleteObject(target).catch(() => undefined);
    throw error;
  }
}

export async function getObjectInfo(ctx: Ctx): Promise<void> {
  const { m, bucket } = await bucketOf(ctx);
  const version = await versionFromQuery(pool, ctx, bucket);
  authorize(m, "read");
  sendJson(ctx, 200, {
    key: version.key, version_id: version.version_id, etag: version.etag, size: version.size, content_type: version.content_type,
    last_modified: isoSecond(version.last_modified), metadata: version.metadata, tags: version.tags,
  });
}

export async function downloadContent(ctx: Ctx): Promise<void> {
  const { m, bucket } = await bucketOf(ctx);
  const version = await versionFromQuery(pool, ctx, bucket);
  authorize(m, "read", true);
  const body = await openVersion(bucket, version);
  await meterRead(bucket, version.size);
  await streamBody(ctx, 200, {
    "Content-Type": servedType(version, false), "Content-Length": version.size, ETag: version.etag,
    "Last-Modified": version.last_modified.toUTCString(), ...downloadHeaders(version.key),
  }, body);
}

export async function listVersions(ctx: Ctx): Promise<void> {
  const { m, bucket } = await bucketOf(ctx);
  authorize(m, "read");
  const rows = await query<Version>(pool,
    "SELECT * FROM versions WHERE bucket_id = $1 AND key = $2 ORDER BY created_at DESC, version_id", [bucket.id, ctx.query.get("key") ?? ""]);
  if (!rows.length) throw new ApiError("not_found");
  sendJson(ctx, 200, {
    versions: rows.map((v) => ({
      version_id: v.version_id, etag: v.etag, size: v.size, created_at: isoSecond(v.created_at), current: v.current,
      noncurrent_since: isoOrNull(v.noncurrent_since), retain_until: isoOrNull(v.retain_until), legal_hold: v.legal_hold,
    })),
  });
}

export async function deleteCurrent(ctx: Ctx): Promise<void> {
  const { m, bucket } = await bucketOf(ctx);
  const key = ctx.query.get("key") ?? "";
  if (!(await currentVersion(pool, bucket.id, key))) throw new ApiError("not_found");
  authorize(m, "write", true);
  const ended = await tx((client) => plainDelete(client, bucket, key));
  if (!ended) throw new ApiError("not_found");
  sendNoContent(ctx);
}

export async function deleteVersion(ctx: Ctx): Promise<void> {
  const { m, bucket } = await bucketOf(ctx);
  await versionFromQuery(pool, ctx, bucket);
  authorize(m, "write", true);
  const outcome = await tx((client) => permanentDelete(client, bucket, ctx.query.get("key") ?? "", ctx.query.get("version") ?? ""));
  if (outcome === "unknown") throw new ApiError("not_found");
  sendNoContent(ctx);
}

const lockJson = (v: Version, now: Date): Record<string, unknown> => ({
  version_id: v.version_id, retain_until: isoOrNull(v.retain_until), legal_hold: v.legal_hold, locked: isLocked(v, now),
});

export async function setRetention(ctx: Ctx): Promise<void> {
  const { m, bucket } = await bucketOf(ctx);
  const version = await versionFromQuery(pool, ctx, bucket);
  authorize(m, "write");
  const body = await readJson(ctx);
  const errors = fieldErrors(body, ["retain_until"], ["retain_until"]);
  const text = body.retain_until;
  const until = typeof text === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(text) ? new Date(text) : null;
  const second = until && !Number.isNaN(until.getTime()) ? new Date(Math.floor(until.getTime() / 1000) * 1000) : null;
  const latest = ctx.now.getTime() + RETENTION_DAYS_MAX * config.daySeconds * 1000;
  if (!errors.retain_until && (!second || second.getTime() <= ctx.now.getTime() || second.getTime() > latest)) {
    errors.retain_until = RETENTION_MESSAGE;
  }
  const saved = await tx(async (client) => {
    const v = await one<Version>(client, "SELECT * FROM versions WHERE version_id = $1 FOR UPDATE", [version.version_id]);
    if (!v) throw new ApiError("not_found");
    // The state conflict precedes validation: any earlier time against retention in force is refused as a shortening.
    if (second && v.retain_until && retentionInForce(v.retain_until, ctx.now) && second.getTime() < v.retain_until.getTime()) {
      throw new ApiError("retention_locked");
    }
    if (Object.keys(errors).length || !second) throw invalid(errors);
    return row<Version>(client, "UPDATE versions SET retain_until = $2 WHERE version_id = $1 RETURNING *", [v.version_id, second]);
  });
  sendJson(ctx, 200, lockJson(saved, ctx.now));
}

// Turning a hold off is a sensitive action under step-up confirmation.
export async function setLegalHold(ctx: Ctx): Promise<void> {
  const { m, bucket } = await bucketOf(ctx);
  const version = await versionFromQuery(pool, ctx, bucket);
  const body = await readJson(ctx);
  authorize(m, "legal_hold", false, body.on === false && version.legal_hold);
  const errors = fieldErrors(body, ["on"], ["on"]);
  if (!errors.on && typeof body.on !== "boolean") errors.on = "Choose on or off.";
  if (Object.keys(errors).length) throw invalid(errors);
  const on = body.on === true;
  const saved = await tx(async (client) => {
    const v = await one<Version>(client, "SELECT * FROM versions WHERE version_id = $1 FOR UPDATE", [version.version_id]);
    if (!v) throw new ApiError("not_found");
    if (v.legal_hold === on) return v;
    await appendAudit(client, m.workspace.slug,
      { actor: m.user.email, action: "legal_hold.changed", target: v.key, detail: `${v.version_id} ${on ? "on" : "off"}` }, ctx.now);
    return row<Version>(client, "UPDATE versions SET legal_hold = $2 WHERE version_id = $1 RETURNING *", [v.version_id, on]);
  });
  sendJson(ctx, 200, lockJson(saved, ctx.now));
}

export async function getReplicas(ctx: Ctx): Promise<void> {
  const { m, bucket } = await bucketOf(ctx);
  const version = await versionFromQuery(pool, ctx, bucket);
  authorize(m, "read");
  const replicas = await replicasOf(pool, version.version_id);
  sendJson(ctx, 200, {
    version_id: version.version_id, etag: version.etag, acknowledged_at: isoSecond(version.acknowledged_at),
    ready: version.current && isReady(replicas), replicas: replicas.map(replicaJson),
  });
}

export async function retryRegion(ctx: Ctx): Promise<void> {
  const { m, bucket } = await bucketOf(ctx);
  const version = await versionFromQuery(pool, ctx, bucket);
  authorize(m, "write", true);
  const replica = await tx((client) => retryReplica(client, version.version_id, ctx.params.region ?? ""));
  sendJson(ctx, 202, replicaJson(replica));
}

// ---- Bulk delete and undo ----

export async function bulkDelete(ctx: Ctx): Promise<void> {
  const { m, bucket } = await bucketOf(ctx);
  authorize(m, "write", true);
  const idemKey = header(ctx, "idempotency-key");
  const raw = await readBody(ctx, 65_536);
  if (raw === null) throw new ApiError("payload_too_large");
  if (await replayIfKnown(ctx, m, idemKey, "bulk-delete", bucket.name, "", raw)) return;
  const body = parseJsonObject(raw);
  const errors = fieldErrors(body, ["keys"], ["keys"]);
  const keys = body.keys;
  if (!errors.keys && !(Array.isArray(keys) && keys.length >= 1 && keys.length <= DELETE_ENTRIES_MAX &&
      keys.every((k) => typeof k === "string" && keyAllowed(k)) && new Set(keys).size === keys.length)) {
    errors.keys = "Choose 1 to 1,000 different keys.";
  }
  if (idemKey !== undefined && !idempotencyKeyAllowed(idemKey)) errors.idempotency_key = IDEMPOTENCY_KEY_MESSAGE;
  if (Object.keys(errors).length) throw invalid(errors);
  const results: Array<{ key: string; outcome: "deleted" | "not_found"; version_id: string | null }> = [];
  for (const key of keys as string[]) {
    const ended = await tx((client) => plainDelete(client, bucket, key));
    results.push({ key, outcome: ended ? "deleted" : "not_found", version_id: ended?.version_id ?? null });
  }
  const deleted = results.filter((r) => r.outcome === "deleted");
  let batchId: string | null = null;
  let undoUntil: Date | null = null;
  if (deleted.length) {
    batchId = newId();
    const ack = new Date(Math.floor(Date.now() / 1000) * 1000);
    undoUntil = new Date(ack.getTime() + config.undoSeconds * 1000);
    ctx.now = ack;
    await tx(async (client) => {
      await client.query("INSERT INTO batches (id, workspace_id, bucket_id, state, undo_until, created_at) VALUES ($1,$2,$3,'open',$4,$5)",
        [batchId, m.workspace.id, bucket.id, undoUntil, ack]);
      for (const [position, r] of deleted.entries()) {
        await client.query("INSERT INTO batch_entries (batch_id, position, key, version_id) VALUES ($1, $2, $3, $4)",
          [batchId, position, r.key, r.version_id]);
      }
    });
  }
  const response = { batch_id: batchId, undo_until: isoOrNull(undoUntil), results };
  await rememberIdempotent(m, idemKey, "bulk-delete", bucket.name, "", raw, 200, response);
  sendJson(ctx, 200, response);
}

export async function undoBatch(ctx: Ctx): Promise<void> {
  const m = await membership(ctx, ctx.params.ws ?? "");
  const result = await tx(async (client) => {
    const batch = await one<{ id: string; bucket_id: number; state: string; undo_until: Date }>(client,
      "SELECT * FROM batches WHERE id = $1 AND workspace_id = $2 FOR UPDATE", [ctx.params.id ?? "", m.workspace.id]);
    if (!batch) throw new ApiError("not_found");
    authorize(m, "write", true);
    if (batch.state === "undone") throw transition("undone", "undone");
    if (ctx.now.getTime() >= batch.undo_until.getTime()) throw new ApiError("undo_expired");
    const bucket = await one<Bucket>(client, "SELECT * FROM buckets WHERE id = $1", [batch.bucket_id]);
    if (!bucket) throw new ApiError("not_found");
    const entries = await query<{ key: string; version_id: string }>(client,
      "SELECT key, version_id FROM batch_entries WHERE batch_id = $1 ORDER BY position", [batch.id]);
    const results = [];
    for (const entry of entries) {
      results.push({ key: entry.key, outcome: await restoreVersion(client, bucket, entry.key, entry.version_id), version_id: entry.version_id });
    }
    await client.query("UPDATE batches SET state = 'undone' WHERE id = $1", [batch.id]);
    return { batch_id: batch.id, state: "undone", results };
  });
  sendJson(ctx, 200, result);
}
