import * as crypto from 'node:crypto';
import { advisoryLock, query, transaction } from '../../db';
import { limits } from '../../config';
import { apiError, validation } from '../../errors';
import { isoSecond } from '../../format';
import { decryptBytes } from '../../crypto/objects';
import { unwrapDataKey } from '../../crypto/seal';
import { getBytes, regionObjectKey } from '../../services/storage';
import {
  PayloadTooLarge,
  header,
  nowSecond,
  onlyFields,
  readBody,
  readJsonBody,
  requireXRequestedWith,
  sendJson,
  sendNoContent,
  setHeaders,
  type Context,
} from '../core';
import {
  requireActiveWorkspace,
  requireCapability,
  requireStepUp,
  requireWorkspace,
  resolveCaller,
  type WorkspaceScope,
} from '../../domain/auth';
import {
  bucketJson,
  createBucket,
  isValidBucketName,
  isValidPlacement,
  knownRegionIds,
  lifecycleJson,
  listBuckets,
  loadBucketForWorkspace,
  loadBucketIn,
  bucketNameMessage,
  placementMessage,
  validateLifecycle,
  type BucketRecord,
} from '../../domain/buckets';
import {
  downloadHeaders,
  isRiskyType,
  isValidMetadata,
  isValidObjectKey,
  isValidTags,
  judgeContent,
  keyMessage,
  metadataMessage,
  parseTagging,
  scriptedSvgMessage,
  tagsMessage,
} from '../../domain/content';
import { CursorError, cursorMessage, listObjects, searchObjects, validateListInputs } from '../../domain/listing';
import { TagFilterError } from '../../domain/tagfilter';
import {
  currentVersion,
  currentVersionIn,
  isLocked,
  listVersions,
  lockKey,
  plainDelete,
  removeVersion,
  replicaCounts,
  versionById,
  versionByIdIn,
  versionHistoryJson,
} from '../../domain/versions';
import { storeSingleUpload } from '../../domain/uploads';
import { listReplicas, readiness, replicaJson, retryReplica } from '../../domain/replicas';
import { quotaBytesForPlan, reservedBytesForWorkspace, storedBytesForWorkspace } from '../../domain/quota';
import { keysMessage, runBulkDelete, undoBatch } from '../../domain/batches';
import { queueByteRemoval } from '../../domain/lifecycle';
import { recordEgressBytes, recordRequestUnits } from '../../domain/usage';
import { appendAudit } from '../../domain/audit';
import { config } from '../../config';
import type { Router } from '../router';

async function scopeFor(ctx: Context): Promise<WorkspaceScope> {
  return requireWorkspace(await resolveCaller(ctx), ctx.params.ws);
}

async function bucketFor(scope: WorkspaceScope, name: string): Promise<BucketRecord> {
  const bucket = await loadBucketForWorkspace(scope.workspace.slug, name);
  if (!bucket) throw apiError('not_found');
  return bucket;
}

function requiredKey(ctx: Context): string {
  const key = ctx.query.get('key');
  if (key === null) throw validation({ key: 'This field is required.' });
  return key;
}

function metadataFrom(ctx: Context): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const [name, value] of Object.entries(ctx.req.headers)) {
    if (!name.startsWith('x-amz-meta-')) continue;
    metadata[name.slice('x-amz-meta-'.length)] = Array.isArray(value) ? value.join(',') : (value ?? '');
  }
  return metadata;
}

async function regionState(id: string): Promise<string> {
  const found = await query<{ state: string }>('select state from regions where id = $1', [id]);
  return found[0]?.state ?? 'online';
}

interface IdempotencyRecord {
  endpoint: string;
  bucket: string;
  object_key: string;
  body_sha: string;
  status: number | null;
  response: Record<string, unknown> | null;
  completed: boolean;
}

/** Console idempotency: the same key, request and body replays the stored response. */
async function idempotency(
  slug: string,
  idempotencyKey: string | undefined,
  endpoint: string,
  bucket: string,
  objectKey: string,
  bodySha: string,
): Promise<{ replay: { status: number; response: Record<string, unknown> } | null; store: boolean }> {
  if (!idempotencyKey) return { replay: null, store: false };
  await query('delete from idempotency_records where created_at < now() - ($1 || \' seconds\')::interval', [
    String(config.timing.idempotencyTtl),
  ]);
  const existing = await query<IdempotencyRecord>(
    'select endpoint, bucket, object_key, body_sha, status, response, completed from idempotency_records where workspace_slug = $1 and idempotency_key = $2',
    [slug, idempotencyKey],
  );
  if (existing.length === 0) {
    await query(
      `insert into idempotency_records (workspace_slug, idempotency_key, endpoint, bucket, object_key, body_sha)
       values ($1, $2, $3, $4, $5, $6) on conflict do nothing`,
      [slug, idempotencyKey, endpoint, bucket, objectKey, bodySha],
    );
    return { replay: null, store: true };
  }
  const record = existing[0];
  if (record.endpoint !== endpoint || record.bucket !== bucket || record.object_key !== objectKey || record.body_sha !== bodySha) {
    throw apiError('idempotency_key_reused', 'This idempotency key was used for a different request.');
  }
  if (record.completed && record.response) return { replay: { status: record.status ?? 200, response: record.response }, store: false };
  return { replay: null, store: true };
}

async function completeIdempotency(
  slug: string,
  idempotencyKey: string | undefined,
  status: number,
  response: Record<string, unknown>,
): Promise<void> {
  if (!idempotencyKey) return;
  await query(
    'update idempotency_records set status = $3, response = $4, completed = true where workspace_slug = $1 and idempotency_key = $2',
    [slug, idempotencyKey, status, JSON.stringify(response)],
  );
}

function validateIdempotencyKey(value: string | undefined): void {
  if (value === undefined) return;
  if (!/^[\x20-\x7e]{1,128}$/.test(value)) {
    throw validation({ idempotency_key: 'Idempotency keys are 1 to 128 printable ASCII characters.' });
  }
}

async function objectBody(version: {
  bucket: string;
  version_id: string;
  wrapped_data_key: string;
  key_generation: number;
}, placement: string[], slug: string): Promise<Buffer> {
  const ciphertext = await getBytes(regionObjectKey(placement[0], version.bucket, version.version_id));
  if (ciphertext === null) throw apiError('storage_unavailable', "Farshore can't reach storage right now.");
  return decryptBytes(unwrapDataKey(slug, version.key_generation, version.wrapped_data_key), ciphertext);
}

export function registerObjectRoutes(router: Router): void {
  router.get('/api/w/:ws/buckets', async (ctx) => {
    const scope = await scopeFor(ctx);
    const buckets = await listBuckets(scope.workspace.slug);
    sendJson(ctx, 200, { buckets: buckets.map(bucketJson) });
  });

  router.post('/api/w/:ws/buckets', async (ctx) => {
    requireXRequestedWith(ctx);
    const scope = await scopeFor(ctx);
    await requireCapability(scope, 'write', ctx, ctx.path);
    requireActiveWorkspace(scope);
    const body = await readJsonBody(ctx, limits.jsonBody);
    const failures = onlyFields(body, ['name', 'placement']);
    const regions = await knownRegionIds();
    if (!('name' in body)) failures.name = 'This field is required.';
    else if (typeof body.name !== 'string' || !isValidBucketName(body.name)) failures.name = bucketNameMessage;
    if (!('placement' in body)) failures.placement = 'This field is required.';
    else if (!isValidPlacement(body.placement, regions)) failures.placement = placementMessage;
    if (Object.keys(failures).length > 0) throw validation(failures);
    const created = await transaction(async (client) => {
      await advisoryLock(client, `bucket-name:${body.name as string}`);
      return createBucket(client, scope.workspace.slug, body.name as string, body.placement as string[]);
    });
    sendJson(ctx, 201, bucketJson(created));
  });

  router.get('/api/w/:ws/buckets/:bucket', async (ctx) => {
    const scope = await scopeFor(ctx);
    sendJson(ctx, 200, bucketJson(await bucketFor(scope, ctx.params.bucket)));
  });

  router.get('/api/w/:ws/buckets/:bucket/lifecycle', async (ctx) => {
    const scope = await scopeFor(ctx);
    sendJson(ctx, 200, lifecycleJson(await bucketFor(scope, ctx.params.bucket)));
  });

  router.put('/api/w/:ws/buckets/:bucket/lifecycle', async (ctx) => {
    requireXRequestedWith(ctx);
    const scope = await scopeFor(ctx);
    const bucket = await bucketFor(scope, ctx.params.bucket);
    await requireCapability(scope, 'manage_versions', ctx, bucket.name);
    const body = await readJsonBody(ctx, limits.jsonBody);
    const extra = onlyFields(body, ['noncurrent_days', 'keep_newest_noncurrent', 'abort_multipart_days']);
    if (Object.keys(extra).length > 0) throw validation(extra);
    const rules = validateLifecycle(body);
    const saved = await transaction(async (client) => {
      await client.query(
        `update buckets set noncurrent_days = $2, keep_newest_noncurrent = $3, abort_multipart_days = $4,
           lifecycle_updated_at = date_trunc('second', now()) where name = $1`,
        [bucket.name, rules.noncurrentDays, rules.keepNewest, rules.abortDays],
      );
      return loadBucketIn(client, bucket.name);
    });
    sendJson(ctx, 200, lifecycleJson(saved as BucketRecord));
  });

  router.get('/api/w/:ws/buckets/:bucket/objects', async (ctx) => {
    const scope = await scopeFor(ctx);
    const bucket = await bucketFor(scope, ctx.params.bucket);
    const prefix = ctx.query.get('prefix') ?? '';
    const delimiter = ctx.query.get('delimiter') ?? '';
    const tagFilter = ctx.query.get('tag_filter') ?? '';
    const limitText = ctx.query.get('limit');
    const failures = validateListInputs(prefix, delimiter);
    let limit = 100;
    if (limitText !== null) {
      limit = Number(limitText);
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) failures.limit = 'Use a page size from 1 to 1,000.';
    }
    if (Object.keys(failures).length > 0) throw validation(failures);
    try {
      const result = await listObjects({
        bucket: bucket.name,
        prefix,
        delimiter,
        tagFilter,
        limit,
        cursor: ctx.query.get('cursor'),
      });
      const counts = await replicaCounts(result.items.map((item) => item.version_id));
      sendJson(ctx, 200, {
        items: result.items.map((item) => ({
          key: item.key,
          version_id: item.version_id,
          size: item.size,
          etag: item.etag,
          content_type: item.content_type,
          last_modified: isoSecond(item.last_modified),
          tags: item.tags,
          replicas_settled: counts.get(item.version_id)?.settled ?? 0,
          replicas_total: counts.get(item.version_id)?.total ?? bucket.placement.length,
        })),
        common_prefixes: result.commonPrefixes,
        next_cursor: result.nextCursor,
        truncated: result.truncated,
      });
    } catch (error) {
      if (error instanceof TagFilterError) throw validation({ tag_filter: error.message });
      if (error instanceof CursorError) throw validation({ cursor: cursorMessage });
      throw error;
    }
  });

  router.get('/api/w/:ws/search', async (ctx) => {
    const scope = await scopeFor(ctx);
    const term = ctx.query.get('q') ?? '';
    if (Array.from(term).length < 1 || Array.from(term).length > 128) {
      throw validation({ q: 'Searches are 1 to 128 characters.' });
    }
    const found = await searchObjects(scope.workspace.slug, term);
    sendJson(ctx, 200, {
      items: found.items.map((item) => ({ ...item, last_modified: isoSecond(item.last_modified) })),
      truncated: found.truncated,
    });
  });

  router.put('/api/w/:ws/buckets/:bucket/object', async (ctx) => {
    requireXRequestedWith(ctx);
    const scope = await scopeFor(ctx);
    const bucket = await bucketFor(scope, ctx.params.bucket);
    const key = requiredKey(ctx);
    await requireCapability(scope, 'write', ctx, key);
    requireActiveWorkspace(scope);

    const idempotencyKey = header(ctx, 'idempotency-key');
    validateIdempotencyKey(idempotencyKey);
    const declaredText = header(ctx, 'x-upload-size');
    if (declaredText === undefined || !/^\d+$/.test(declaredText)) {
      throw validation({ size: 'Send the upload size in X-Upload-Size.' });
    }
    const declared = Number(declaredText);

    let bytes: Buffer;
    try {
      bytes = await readBody(ctx, limits.singleUpload + 1);
    } catch (error) {
      if (error instanceof PayloadTooLarge) throw apiError('payload_too_large', 'That file is over the single-upload limit.');
      throw error;
    }
    const bodySha = crypto.createHash('sha256').update(bytes).digest('hex');
    const replay = await idempotency(scope.workspace.slug, idempotencyKey, 'object', bucket.name, key, bodySha);
    if (replay.replay) {
      sendJson(ctx, replay.replay.status, replay.replay.response, { 'Idempotent-Replayed': 'true' });
      return;
    }

    const ifMatch = header(ctx, 'if-match');
    const ifNoneMatch = header(ctx, 'if-none-match');
    const current = await currentVersion(bucket.name, key);
    if (ifMatch !== undefined) {
      if (!current) throw apiError('not_found', 'That key has no current version.');
      if (current.etag !== ifMatch.trim()) {
        throw apiError('precondition_failed', 'The object changed since you read it.', { current_etag: current.etag });
      }
    }
    if (ifNoneMatch !== undefined && ifNoneMatch.trim() === '*' && current) {
      throw apiError('precondition_failed', 'That key already has a current version.', { current_etag: current.etag });
    }

    if (declared > limits.singleUpload || bytes.length > limits.singleUpload) {
      throw apiError('payload_too_large', 'That file is over the single-upload limit.');
    }

    const metadata = metadataFrom(ctx);
    const taggingHeader = header(ctx, 'x-amz-tagging');
    const tags = taggingHeader === undefined ? {} : parseTagging(taggingHeader);
    const failures: Record<string, string> = {};
    if (!isValidObjectKey(key)) failures.key = keyMessage;
    if (!isValidMetadata(metadata)) failures.metadata = metadataMessage;
    if (tags === null || !isValidTags(tags)) failures.tags = tagsMessage;
    if (Object.keys(failures).length > 0) throw validation(failures);

    if (await regionState(bucket.placement[0]) === 'offline') {
      throw apiError('region_offline', 'That region is offline.');
    }

    if (bytes.length !== declared) {
      throw validation({ size: `Declared size ${declared} bytes does not match ${bytes.length} bytes received.` });
    }
    const judged = judgeContent(header(ctx, 'content-type'), bytes);
    if (judged.scriptedSvg) throw validation({ content: scriptedSvgMessage });

    const stored = await transaction(async (client) => {
      await advisoryLock(client, `quota:${scope.workspace.slug}`);
      const quota = quotaBytesForPlan(scope.workspace.plan_id);
      if (quota !== null) {
        const storedBytes = await storedBytesForWorkspace(client, scope.workspace.slug);
        const reserved = await reservedBytesForWorkspace(client, scope.workspace.slug);
        const incoming = BigInt(bytes.length) * BigInt(bucket.placement.length);
        if (storedBytes + reserved + incoming > BigInt(quota)) {
          throw apiError('quota_exceeded', 'This workspace is at its storage limit.', {
            quota_bytes: quota,
            stored_bytes: Number(storedBytes),
            reserved_bytes: Number(reserved),
          });
        }
      }
      await lockKey(client, bucket.name, key);
      const live = await currentVersionIn(client, bucket.name, key);
      if (ifMatch !== undefined) {
        if (!live) throw apiError('not_found', 'That key has no current version.');
        if (live.etag !== ifMatch.trim()) {
          throw apiError('precondition_failed', 'The object changed since you read it.', { current_etag: live.etag });
        }
      }
      if (ifNoneMatch !== undefined && ifNoneMatch.trim() === '*' && live) {
        throw apiError('precondition_failed', 'That key already has a current version.', { current_etag: live.etag });
      }
      const bucketNow = (await loadBucketIn(client, bucket.name)) as BucketRecord;
      return storeSingleUpload(client, {
        bucket: bucketNow,
        workspaceSlug: scope.workspace.slug,
        keyGeneration: Number(scope.workspace.key_generation),
        key,
        bytes,
        contentType: judged.contentType,
        metadata,
        tags: tags as Record<string, string>,
        meterRequestUnit: true,
      });
    });

    const replicas = await listReplicas(stored.version_id);
    const response = {
      bucket: bucket.name,
      key,
      version_id: stored.version_id,
      etag: stored.etag,
      size: Number(stored.size),
      content_type: stored.content_type,
      last_modified: isoSecond(stored.acknowledged_at),
      replicas: replicas.map(replicaJson),
    };
    await completeIdempotency(scope.workspace.slug, idempotencyKey, 201, response);
    sendJson(ctx, 201, response);
  });

  router.get('/api/w/:ws/buckets/:bucket/object', async (ctx) => {
    const scope = await scopeFor(ctx);
    const bucket = await bucketFor(scope, ctx.params.bucket);
    const key = requiredKey(ctx);
    const version = await currentVersion(bucket.name, key);
    if (!version) throw apiError('not_found');
    sendJson(ctx, 200, {
      key: version.object_key,
      version_id: version.version_id,
      etag: version.etag,
      size: Number(version.size),
      content_type: version.content_type,
      last_modified: isoSecond(version.acknowledged_at),
      metadata: version.metadata,
      tags: version.tags,
    });
  });

  router.get('/api/w/:ws/buckets/:bucket/object/content', async (ctx) => {
    const scope = await scopeFor(ctx);
    const bucket = await bucketFor(scope, ctx.params.bucket);
    const key = requiredKey(ctx);
    requireActiveWorkspace(scope);
    const versionId = ctx.query.get('version');
    const version = versionId ? await versionById(bucket.name, versionId) : await currentVersion(bucket.name, key);
    if (!version || version.object_key !== key) throw apiError('not_found');
    const bytes = await objectBody(version, bucket.placement, scope.workspace.slug);
    await transaction(async (client) => {
      await recordRequestUnits(client, bucket.workspace_slug, bucket.name, 1);
      await recordEgressBytes(client, bucket.workspace_slug, bucket.name, bytes.length);
    });
    setHeaders(ctx, downloadHeaders(key));
    ctx.res.statusCode = 200;
    ctx.res.setHeader('Content-Type', isRiskyType(version.content_type) ? 'application/octet-stream' : version.content_type);
    ctx.res.setHeader('Content-Length', bytes.length);
    ctx.res.setHeader('ETag', version.etag);
    ctx.res.end(ctx.method === 'HEAD' ? undefined : bytes);
  });

  router.get('/api/w/:ws/buckets/:bucket/object/versions', async (ctx) => {
    const scope = await scopeFor(ctx);
    const bucket = await bucketFor(scope, ctx.params.bucket);
    const key = requiredKey(ctx);
    const versions = await listVersions(bucket.name, key);
    sendJson(ctx, 200, { versions: versions.map(versionHistoryJson) });
  });

  router.delete('/api/w/:ws/buckets/:bucket/object', async (ctx) => {
    requireXRequestedWith(ctx);
    const scope = await scopeFor(ctx);
    const bucket = await bucketFor(scope, ctx.params.bucket);
    const key = requiredKey(ctx);
    await requireCapability(scope, 'write', ctx, key);
    requireActiveWorkspace(scope);
    const deleted = await transaction(async (client) => {
      await lockKey(client, bucket.name, key);
      const bucketNow = (await loadBucketIn(client, bucket.name)) as BucketRecord;
      return plainDelete(client, bucketNow, key, { meterRequestUnit: true });
    });
    if (!deleted) throw apiError('not_found');
    sendNoContent(ctx);
  });

  router.delete('/api/w/:ws/buckets/:bucket/object/version', async (ctx) => {
    requireXRequestedWith(ctx);
    const scope = await scopeFor(ctx);
    const bucket = await bucketFor(scope, ctx.params.bucket);
    const key = requiredKey(ctx);
    await requireCapability(scope, 'manage_versions', ctx, key);
    requireActiveWorkspace(scope);
    const versionId = ctx.query.get('version');
    if (!versionId) throw validation({ version: 'This field is required.' });
    await transaction(async (client) => {
      await lockKey(client, bucket.name, key);
      const version = await versionByIdIn(client, bucket.name, versionId);
      if (!version || version.object_key !== key) throw apiError('not_found');
      if (version.is_current) {
        throw apiError('invalid_transition', 'A current version cannot be removed.', { from: 'current', to: 'removed' });
      }
      if (isLocked(version)) {
        throw apiError('object_locked', 'This version is under retention or legal hold.', {
          retain_until: version.retain_until ? isoSecond(version.retain_until) : null,
          legal_hold: version.legal_hold,
        });
      }
      const bucketNow = (await loadBucketIn(client, bucket.name)) as BucketRecord;
      await removeVersion(client, bucketNow, version, 'request');
      for (const region of bucketNow.placement) {
        await queueByteRemoval(client, regionObjectKey(region, bucketNow.name, versionId));
      }
    });
    sendNoContent(ctx);
  });

  router.put('/api/w/:ws/buckets/:bucket/object/retention', async (ctx) => {
    requireXRequestedWith(ctx);
    const scope = await scopeFor(ctx);
    const bucket = await bucketFor(scope, ctx.params.bucket);
    const key = requiredKey(ctx);
    await requireCapability(scope, 'manage_versions', ctx, key);
    const versionId = ctx.query.get('version');
    const body = await readJsonBody(ctx, limits.jsonBody);
    const extra = onlyFields(body, ['retain_until']);
    if (Object.keys(extra).length > 0) throw validation(extra);
    const message = 'Pick a time after now and within 3,650 days.';
    if (typeof body.retain_until !== 'string') throw validation({ retain_until: message });
    const retainUntil = new Date(body.retain_until);
    const now = nowSecond();
    if (
      Number.isNaN(retainUntil.getTime()) ||
      retainUntil.getTime() <= now.getTime() ||
      retainUntil.getTime() > now.getTime() + 3650 * config.timing.day * 1000
    ) {
      throw validation({ retain_until: message });
    }
    const updated = await transaction(async (client) => {
      const version = await versionByIdIn(client, bucket.name, versionId ?? '');
      if (!version || version.object_key !== key) throw apiError('not_found');
      const inForce = version.retain_until !== null && now.getTime() < new Date(version.retain_until).getTime();
      if (inForce) {
        const existing = new Date(version.retain_until as string).getTime();
        if (retainUntil.getTime() < existing) throw apiError('retention_locked', 'Retention can be extended but not shortened.');
        if (retainUntil.getTime() === existing) return version;
      }
      await client.query('update object_versions set retain_until = $2 where version_id = $1', [
        version.version_id,
        retainUntil.toISOString(),
      ]);
      return { ...version, retain_until: retainUntil.toISOString() };
    });
    sendJson(ctx, 200, {
      version_id: updated.version_id,
      retain_until: updated.retain_until ? isoSecond(updated.retain_until) : null,
      legal_hold: updated.legal_hold,
      locked: isLocked(updated),
    });
  });

  router.put('/api/w/:ws/buckets/:bucket/object/legal-hold', async (ctx) => {
    requireXRequestedWith(ctx);
    const scope = await scopeFor(ctx);
    const bucket = await bucketFor(scope, ctx.params.bucket);
    const key = requiredKey(ctx);
    await requireCapability(scope, 'legal_hold', ctx, key);
    const versionId = ctx.query.get('version');
    const body = await readJsonBody(ctx, limits.jsonBody);
    const extra = onlyFields(body, ['on']);
    if (Object.keys(extra).length > 0) throw validation(extra);
    if (typeof body.on !== 'boolean') throw validation({ on: 'Choose on or off.' });
    if (body.on === false) requireStepUp(scope);
    const updated = await transaction(async (client) => {
      const version = await versionByIdIn(client, bucket.name, versionId ?? '');
      if (!version || version.object_key !== key) throw apiError('not_found');
      if (version.legal_hold === body.on) return version;
      await client.query('update object_versions set legal_hold = $2 where version_id = $1', [version.version_id, body.on]);
      await appendAudit(client, scope.workspace.slug, {
        actor: scope.principal.user.email,
        action: 'legal_hold.changed',
        target: key,
        detail: `${version.version_id} ${body.on === true ? 'on' : 'off'}`,
      });
      return { ...version, legal_hold: body.on as boolean };
    });
    sendJson(ctx, 200, {
      version_id: updated.version_id,
      retain_until: updated.retain_until ? isoSecond(updated.retain_until) : null,
      legal_hold: updated.legal_hold,
      locked: isLocked(updated),
    });
  });

  router.get('/api/w/:ws/buckets/:bucket/object/replicas', async (ctx) => {
    const scope = await scopeFor(ctx);
    const bucket = await bucketFor(scope, ctx.params.bucket);
    const key = requiredKey(ctx);
    const versionId = ctx.query.get('version');
    const version = versionId ? await versionById(bucket.name, versionId) : await currentVersion(bucket.name, key);
    if (!version || version.object_key !== key) throw apiError('not_found');
    const replicas = await listReplicas(version.version_id);
    const counts = await readiness(version.version_id);
    sendJson(ctx, 200, {
      version_id: version.version_id,
      etag: version.etag,
      acknowledged_at: isoSecond(version.acknowledged_at),
      ready: counts.placed > 0 && counts.settled === counts.placed,
      replicas: replicas.map(replicaJson),
    });
  });

  router.post('/api/w/:ws/buckets/:bucket/object/replicas/:region/retry', async (ctx) => {
    requireXRequestedWith(ctx);
    const scope = await scopeFor(ctx);
    const bucket = await bucketFor(scope, ctx.params.bucket);
    const key = requiredKey(ctx);
    await requireCapability(scope, 'write', ctx, key);
    requireActiveWorkspace(scope);
    const versionId = ctx.query.get('version');
    const version = versionId ? await versionById(bucket.name, versionId) : await currentVersion(bucket.name, key);
    if (!version || version.object_key !== key) throw apiError('not_found');
    const replica = await transaction(async (client) => retryReplica(client, version.version_id, ctx.params.region));
    sendJson(ctx, 202, replicaJson(replica));
  });

  router.post('/api/w/:ws/buckets/:bucket/objects/delete', async (ctx) => {
    requireXRequestedWith(ctx);
    const scope = await scopeFor(ctx);
    const bucket = await bucketFor(scope, ctx.params.bucket);
    await requireCapability(scope, 'manage_versions', ctx, bucket.name);
    requireActiveWorkspace(scope);
    const idempotencyKey = header(ctx, 'idempotency-key');
    validateIdempotencyKey(idempotencyKey);
    const body = await readJsonBody(ctx, limits.jsonBody);
    const bodySha = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const replay = await idempotency(scope.workspace.slug, idempotencyKey, 'bulk-delete', bucket.name, '', bodySha);
    if (replay.replay) {
      sendJson(ctx, replay.replay.status, replay.replay.response, { 'Idempotent-Replayed': 'true' });
      return;
    }
    const extra = onlyFields(body, ['keys']);
    if (Object.keys(extra).length > 0) throw validation(extra);
    const keys = body.keys;
    if (
      !Array.isArray(keys) ||
      keys.length < 1 ||
      keys.length > 1000 ||
      new Set(keys).size !== keys.length ||
      !keys.every((key) => typeof key === 'string' && isValidObjectKey(key))
    ) {
      throw validation({ keys: keysMessage });
    }
    const outcome = await transaction(async (client) => {
      const bucketNow = (await loadBucketIn(client, bucket.name)) as BucketRecord;
      return runBulkDelete(client, bucketNow, keys as string[]);
    });
    const response = {
      batch_id: outcome.batchId,
      undo_until: outcome.undoUntil,
      results: outcome.results,
    };
    await completeIdempotency(scope.workspace.slug, idempotencyKey, 200, response);
    sendJson(ctx, 200, response);
  });

  router.post('/api/w/:ws/batches/:batch_id/undo', async (ctx) => {
    requireXRequestedWith(ctx);
    const scope = await scopeFor(ctx);
    await requireCapability(scope, 'manage_versions', ctx, ctx.path);
    requireActiveWorkspace(scope);
    const result = await transaction(async (client) =>
      undoBatch(client, scope.workspace.slug, ctx.params.batch_id, (name) => loadBucketIn(client, name)),
    );
    sendJson(ctx, 200, { batch_id: ctx.params.batch_id, state: 'undone', results: result.results });
  });
}
