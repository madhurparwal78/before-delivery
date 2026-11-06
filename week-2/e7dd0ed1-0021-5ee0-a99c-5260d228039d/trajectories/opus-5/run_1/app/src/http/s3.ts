import { advisoryLock, query, transaction } from '../db';
import { limits } from '../config';
import { s3Error, S3Error } from '../errors';
import { decryptBytes } from '../crypto/objects';
import { unwrapDataKey } from '../crypto/seal';
import {
  canonicalRequest,
  computeSignature,
  constantTimeEquals,
  parseAuthorization,
  type SigV4Credential,
} from '../crypto/sigv4';
import { getBytes, regionObjectKey } from '../services/storage';
import { header, readBody, sendNoContent, setHeaders, xml, type Context } from './core';
import { declaredDecodedLength, payloadMode, readS3Body, type SigningContext } from './s3body';
import { auditPermissionDenied } from '../domain/auth';
import {
  findKey,
  isExpired,
  keyAllowsBucket,
  keyAllowsListPrefix,
  keyAllowsObjectKey,
  keyAllowsWrite,
  markKeyUsed,
  usableSecrets,
  type AccessKeyRecord,
} from '../domain/keys';
import { loadBucket, loadBucketIn, type BucketRecord } from '../domain/buckets';
import {
  downloadHeaders,
  isValidMetadata,
  isValidObjectKey,
  isValidTags,
  judgeContent,
  parseTagging,
} from '../domain/content';
import { listObjects, CursorError } from '../domain/listing';
import {
  currentVersion,
  currentVersionIn,
  isLocked,
  lockKey,
  plainDelete,
  removeVersion,
  versionById,
  versionByIdIn,
} from '../domain/versions';
import { storeSingleUpload } from '../domain/uploads';
import {
  abortUpload,
  completeUpload,
  createUpload,
  discardStagedBytes,
  findUpload,
  findUploadIn,
  markCompleted,
  partListFingerprint,
  storePart,
  type RequestedPart,
} from '../domain/multipart';
import { quotaBytesForPlan, releaseReservation, reservedBytesForWorkspace, storedBytesForWorkspace } from '../domain/quota';
import { recordEgressBytes, recordRequestUnits } from '../domain/usage';
import { queueByteRemoval } from '../domain/lifecycle';
import type { Router } from './router';

interface S3Caller {
  key: AccessKeyRecord;
  signing: SigningContext;
  workspaceStatus: string;
  workspacePlan: string;
  keyGeneration: number;
}

function requestId(): string {
  return Math.random().toString(16).slice(2, 18).toUpperCase();
}

function amzDateOf(ctx: Context): string {
  const amzDate = header(ctx, 'x-amz-date');
  if (amzDate) return amzDate;
  const date = header(ctx, 'date');
  if (!date) throw s3Error('SignatureDoesNotMatch');
  return new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function skewed(amzDate: string): boolean {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(amzDate);
  if (!match) return true;
  const stamp = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
  return Math.abs(Date.now() - stamp) > 15 * 60 * 1000;
}

async function authenticate(ctx: Context): Promise<S3Caller> {
  const parsed = parseAuthorization(header(ctx, 'authorization'));
  if (!parsed) throw s3Error('InvalidAccessKeyId');
  const key = await findKey(parsed.credential.accessKeyId);
  if (!key || key.state !== 'active' || isExpired(key)) throw s3Error('InvalidAccessKeyId');
  const amzDate = amzDateOf(ctx);
  if (skewed(amzDate)) throw s3Error('RequestTimeTooSkewed');
  const canonical = canonicalRequest(
    ctx.method === 'HEAD' ? 'HEAD' : ctx.method,
    ctx.rawPath,
    ctx.rawQuery,
    ctx.req.headers,
    parsed.signedHeaders,
    payloadMode(ctx),
  );
  const secrets = usableSecrets(key);
  let matched: string | null = null;
  let usedPrevious = false;
  for (const candidate of [secrets.current, secrets.previous]) {
    if (candidate === null) continue;
    if (constantTimeEquals(computeSignature(candidate, parsed, amzDate, canonical), parsed.signature)) {
      matched = candidate;
      usedPrevious = candidate === secrets.previous && candidate !== secrets.current;
      break;
    }
  }
  if (matched === null) throw s3Error('SignatureDoesNotMatch');
  await markKeyUsed(key.key_id, usedPrevious);
  const workspace = await query<{ status: string; plan_id: string; key_generation: number }>(
    'select status, plan_id, key_generation from workspaces where slug = $1',
    [key.workspace_slug],
  );
  return {
    key,
    signing: {
      secret: matched,
      credential: parsed.credential as SigV4Credential,
      amzDate,
      headerSignature: parsed.signature,
    },
    workspaceStatus: workspace[0].status,
    workspacePlan: workspace[0].plan_id,
    keyGeneration: Number(workspace[0].key_generation),
  };
}

async function denyKey(caller: S3Caller, ctx: Context, target: string): Promise<never> {
  await auditPermissionDenied(caller.key.workspace_slug, `key:${caller.key.key_id}`, target, ctx.method, ctx.path);
  throw s3Error('AccessDenied');
}

async function resolveBucket(caller: S3Caller, ctx: Context, name: string): Promise<BucketRecord> {
  const bucket = await loadBucket(name);
  if (!bucket) throw s3Error('NoSuchBucket');
  if (bucket.workspace_slug !== caller.key.workspace_slug) throw s3Error('AccessDenied');
  if (!keyAllowsBucket(caller.key, bucket.name)) await denyKey(caller, ctx, bucket.name);
  return bucket;
}

function requireNotSuspended(caller: S3Caller): void {
  if (caller.workspaceStatus === 'suspended') throw s3Error('AccountSuspended', 'This workspace is suspended.');
}

async function requireWritable(caller: S3Caller, ctx: Context, target: string): Promise<void> {
  if (!keyAllowsWrite(caller.key)) await denyKey(caller, ctx, target);
}

async function requireKeyInScope(caller: S3Caller, ctx: Context, objectKey: string): Promise<void> {
  if (!keyAllowsObjectKey(caller.key, objectKey)) await denyKey(caller, ctx, objectKey);
}

function keyFromPath(ctx: Context): string {
  return ctx.params.rest;
}

function metadataHeaders(ctx: Context): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const [name, value] of Object.entries(ctx.req.headers)) {
    if (!name.startsWith('x-amz-meta-')) continue;
    metadata[name.slice('x-amz-meta-'.length)] = Array.isArray(value) ? value.join(',') : (value ?? '');
  }
  return metadata;
}

function sendXml(ctx: Context, status: number, body: string, headers: Record<string, string> = {}): void {
  const text = `<?xml version="1.0" encoding="UTF-8"?>${body}`;
  setHeaders(ctx, headers);
  ctx.res.statusCode = status;
  ctx.res.setHeader('Content-Type', 'application/xml');
  ctx.res.setHeader('Content-Length', Buffer.byteLength(text));
  ctx.res.end(ctx.method === 'HEAD' ? undefined : text);
}

const listedSafe = new Set('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~/'.split(''));

function urlEncodeListed(value: string): string {
  return Array.from(Buffer.from(value, 'utf8'))
    .map((byte) => {
      const character = String.fromCharCode(byte);
      if (listedSafe.has(character)) return character;
      if (character === ' ') return '+';
      return `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    })
    .join('');
}

function s3Time(value: string): string {
  return new Date(value).toISOString().replace(/\.\d{3}Z$/, '.000Z');
}

async function versionBody(
  version: { bucket: string; version_id: string; wrapped_data_key: string; key_generation: number },
  placement: string[],
  slug: string,
): Promise<Buffer> {
  const ciphertext = await getBytes(regionObjectKey(placement[0], version.bucket, version.version_id));
  if (ciphertext === null) throw s3Error('ServiceUnavailable');
  return decryptBytes(unwrapDataKey(slug, version.key_generation, version.wrapped_data_key), ciphertext);
}

async function quotaCheck(caller: S3Caller, bucket: BucketRecord, incomingBytes: number): Promise<void> {
  const quota = quotaBytesForPlan(caller.workspacePlan);
  if (quota === null) return;
  await transaction(async (client) => {
    await advisoryLock(client, `quota:${bucket.workspace_slug}`);
    const stored = await storedBytesForWorkspace(client, bucket.workspace_slug);
    const reserved = await reservedBytesForWorkspace(client, bucket.workspace_slug);
    const incoming = BigInt(incomingBytes) * BigInt(bucket.placement.length);
    if (stored + reserved + incoming > BigInt(quota)) throw s3Error('QuotaExceeded');
  });
}

async function regionOffline(bucket: BucketRecord): Promise<boolean> {
  const found = await query<{ state: string }>('select state from regions where id = $1', [bucket.placement[0]]);
  return found[0]?.state === 'offline';
}

function conditionHeaders(ctx: Context): { ifMatch: string | undefined; ifNoneMatch: boolean } {
  const ifMatch = header(ctx, 'if-match');
  const ifNoneMatch = header(ctx, 'if-none-match');
  return { ifMatch: ifMatch?.trim(), ifNoneMatch: ifNoneMatch?.trim() === '*' };
}

export function registerS3Routes(router: Router): void {
  router.get('/s3/:bucket', async (ctx) => {
    const caller = await authenticate(ctx);
    if (ctx.query.get('list-type') !== '2') throw s3Error('NotImplemented');
    const bucket = await resolveBucket(caller, ctx, ctx.params.bucket);
    requireNotSuspended(caller);
    const prefix = ctx.query.get('prefix') ?? '';
    if (!keyAllowsListPrefix(caller.key, prefix)) await denyKey(caller, ctx, bucket.name);
    const delimiter = ctx.query.get('delimiter') ?? '';
    const encodingType = ctx.query.get('encoding-type');
    if (encodingType !== null && encodingType !== 'url') throw s3Error('InvalidArgument', 'Unsupported encoding type.');
    const maxKeysText = ctx.query.get('max-keys');
    let maxKeys = 1000;
    if (maxKeysText !== null) {
      if (!/^\d+$/.test(maxKeysText)) throw s3Error('InvalidArgument', 'max-keys must be a non-negative integer.');
      maxKeys = Math.min(1000, Number(maxKeysText));
    }
    const token = ctx.query.get('continuation-token');
    const startAfter = ctx.query.get('start-after') ?? undefined;
    let result;
    try {
      result = await listObjects({
        bucket: bucket.name,
        prefix,
        delimiter,
        tagFilter: '',
        limit: Math.max(1, maxKeys),
        cursor: token,
        startAfter,
      });
    } catch (error) {
      if (error instanceof CursorError) throw s3Error('InvalidArgument', 'The continuation token is not valid.');
      throw error;
    }
    const encode = (value: string): string => (encodingType === 'url' ? urlEncodeListed(value) : xml(value));
    const contents = result.items
      .map(
        (item) =>
          `<Contents><Key>${encode(item.key)}</Key><LastModified>${s3Time(item.last_modified)}</LastModified><ETag>${xml(
            item.etag,
          )}</ETag><Size>${item.size}</Size><StorageClass>STANDARD</StorageClass></Contents>`,
      )
      .join('');
    const prefixes = result.commonPrefixes.map((value) => `<CommonPrefixes><Prefix>${encode(value)}</Prefix></CommonPrefixes>`).join('');
    const keyCount = result.items.length + result.commonPrefixes.length;
    const body =
      `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
      `<Name>${xml(bucket.name)}</Name>` +
      `<Prefix>${encode(prefix)}</Prefix>` +
      `<Delimiter>${encode(delimiter)}</Delimiter>` +
      `<MaxKeys>${maxKeys}</MaxKeys>` +
      `<KeyCount>${keyCount}</KeyCount>` +
      `<IsTruncated>${result.nextCursor !== null}</IsTruncated>` +
      (token !== null ? `<ContinuationToken>${xml(token)}</ContinuationToken>` : '') +
      (result.nextCursor !== null ? `<NextContinuationToken>${xml(result.nextCursor)}</NextContinuationToken>` : '') +
      (startAfter !== undefined ? `<StartAfter>${encode(startAfter)}</StartAfter>` : '') +
      (encodingType === 'url' ? '<EncodingType>url</EncodingType>' : '') +
      contents +
      prefixes +
      `</ListBucketResult>`;
    sendXml(ctx, 200, body);
  });

  router.post('/s3/:bucket', async (ctx) => {
    const caller = await authenticate(ctx);
    if (!ctx.query.has('delete')) throw s3Error('NotImplemented');
    const bucket = await resolveBucket(caller, ctx, ctx.params.bucket);
    await requireWritable(caller, ctx, bucket.name);
    requireNotSuspended(caller);
    const raw = await readBody(ctx, limits.deleteObjectsBody + 1);
    if (raw.length > limits.deleteObjectsBody) throw s3Error('EntityTooLarge');
    const text = raw.toString('utf8');
    const quiet = /<Quiet>\s*true\s*<\/Quiet>/i.test(text);
    const entries = Array.from(text.matchAll(/<Object>([\s\S]*?)<\/Object>/g)).map((match) => {
      const key = /<Key>([\s\S]*?)<\/Key>/.exec(match[1]);
      const version = /<VersionId>([\s\S]*?)<\/VersionId>/.exec(match[1]);
      return {
        key: key ? decodeXml(key[1]) : null,
        versionId: version ? decodeXml(version[1]) : null,
      };
    });
    if (entries.length === 0 || entries.length > 1000 || entries.some((entry) => entry.key === null)) {
      throw s3Error('MalformedXML');
    }
    const seen = new Set<string>();
    const results: string[] = [];
    for (const entry of entries) {
      const objectKey = entry.key as string;
      const identity = `${objectKey}\u0000${entry.versionId ?? ''}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      const versionTag = entry.versionId === null ? '' : `<VersionId>${xml(entry.versionId)}</VersionId>`;
      if (!isValidObjectKey(objectKey)) {
        results.push(
          `<Error><Key>${xml(objectKey)}</Key>${versionTag}<Code>InvalidArgument</Code><Message>This key can't be stored.</Message></Error>`,
        );
        continue;
      }
      if (!keyAllowsObjectKey(caller.key, objectKey)) {
        await auditPermissionDenied(caller.key.workspace_slug, `key:${caller.key.key_id}`, objectKey, ctx.method, ctx.path);
        results.push(
          `<Error><Key>${xml(objectKey)}</Key>${versionTag}<Code>AccessDenied</Code><Message>Access Denied</Message></Error>`,
        );
        continue;
      }
      try {
        await transaction(async (client) => {
          await lockKey(client, bucket.name, objectKey);
          const bucketNow = (await loadBucketIn(client, bucket.name)) as BucketRecord;
          if (entry.versionId === null) {
            await plainDelete(client, bucketNow, objectKey, { meterRequestUnit: true });
            return;
          }
          const version = await versionByIdIn(client, bucket.name, entry.versionId);
          if (!version || version.object_key !== objectKey) return;
          if (version.is_current) throw s3Error('InvalidArgument', 'A current version cannot be removed.');
          if (isLocked(version)) throw s3Error('AccessDenied', 'This version is under retention or legal hold.');
          await removeVersion(client, bucketNow, version, 'request');
          for (const region of bucketNow.placement) {
            await queueByteRemoval(client, regionObjectKey(region, bucketNow.name, version.version_id));
          }
        });
        results.push(`<Deleted><Key>${xml(objectKey)}</Key>${versionTag}</Deleted>`);
      } catch (error) {
        if (error instanceof S3Error) {
          results.push(
            `<Error><Key>${xml(objectKey)}</Key>${versionTag}<Code>${error.code}</Code><Message>${xml(
              error.message,
            )}</Message></Error>`,
          );
          continue;
        }
        throw error;
      }
    }
    const shown = quiet ? results.filter((entry) => entry.startsWith('<Error>')) : results;
    sendXml(ctx, 200, `<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${shown.join('')}</DeleteResult>`);
  });

  router.put('/s3/:bucket/*', async (ctx) => {
    const caller = await authenticate(ctx);
    const objectKey = keyFromPath(ctx);
    const bucket = await resolveBucket(caller, ctx, ctx.params.bucket);
    await requireWritable(caller, ctx, objectKey);
    await requireKeyInScope(caller, ctx, objectKey);
    requireNotSuspended(caller);
    const uploadId = ctx.query.get('uploadId');
    if (uploadId !== null) {
      await uploadPart(ctx, caller, bucket, objectKey, uploadId);
      return;
    }
    await putObject(ctx, caller, bucket, objectKey);
  });

  router.get('/s3/:bucket/*', async (ctx) => {
    const caller = await authenticate(ctx);
    const objectKey = keyFromPath(ctx);
    const bucket = await resolveBucket(caller, ctx, ctx.params.bucket);
    await requireKeyInScope(caller, ctx, objectKey);
    requireNotSuspended(caller);
    const versionId = ctx.query.get('versionId');
    const version = versionId ? await versionById(bucket.name, versionId) : await currentVersion(bucket.name, objectKey);
    if (!version || version.object_key !== objectKey) throw s3Error('NoSuchKey');
    const headers: Record<string, string> = {
      ETag: version.etag,
      'x-amz-version-id': version.version_id,
      'Last-Modified': new Date(version.acknowledged_at).toUTCString(),
      'Content-Type': version.content_type,
      'x-amz-tagging-count': String(Object.keys(version.tags).length),
    };
    for (const [name, value] of Object.entries(version.metadata)) headers[`x-amz-meta-${name}`] = value;
    if (
      (header(ctx, 'x-amz-checksum-mode') ?? '').toUpperCase() === 'ENABLED' &&
      version.checksum_algorithm !== null &&
      version.checksum_value !== null
    ) {
      headers[`x-amz-checksum-${version.checksum_algorithm}`] = version.checksum_value;
    }
    if (ctx.method === 'HEAD') {
      setHeaders(ctx, headers);
      ctx.res.statusCode = 200;
      ctx.res.setHeader('Content-Length', Number(version.size));
      ctx.res.end();
      return;
    }
    const bytes = await versionBody(version, bucket.placement, bucket.workspace_slug);
    await transaction(async (client) => {
      await recordRequestUnits(client, bucket.workspace_slug, bucket.name, 1);
      await recordEgressBytes(client, bucket.workspace_slug, bucket.name, bytes.length);
    });
    setHeaders(ctx, { ...headers, ...downloadHeaders(objectKey) });
    ctx.res.statusCode = 200;
    ctx.res.setHeader('Content-Length', bytes.length);
    ctx.res.end(bytes);
  });

  router.delete('/s3/:bucket/*', async (ctx) => {
    const caller = await authenticate(ctx);
    const objectKey = keyFromPath(ctx);
    const bucket = await resolveBucket(caller, ctx, ctx.params.bucket);
    await requireWritable(caller, ctx, objectKey);
    await requireKeyInScope(caller, ctx, objectKey);
    requireNotSuspended(caller);
    const uploadId = ctx.query.get('uploadId');
    if (uploadId !== null) {
      const upload = await findUpload(uploadId);
      if (!upload || upload.state !== 'open' || upload.bucket !== bucket.name) throw s3Error('NoSuchUpload');
      await transaction(async (client) => {
        const live = await findUploadIn(client, uploadId);
        if (!live || live.state !== 'open') throw s3Error('NoSuchUpload');
        await abortUpload(client, live);
      });
      await discardStagedBytes(uploadId);
      sendNoContent(ctx);
      return;
    }
    const versionId = ctx.query.get('versionId');
    await transaction(async (client) => {
      await lockKey(client, bucket.name, objectKey);
      const bucketNow = (await loadBucketIn(client, bucket.name)) as BucketRecord;
      if (versionId === null) {
        await plainDelete(client, bucketNow, objectKey, { meterRequestUnit: true });
        return;
      }
      const version = await versionByIdIn(client, bucket.name, versionId);
      if (!version || version.object_key !== objectKey) return;
      if (version.is_current) throw s3Error('InvalidArgument', 'A current version cannot be removed.');
      if (isLocked(version)) throw s3Error('AccessDenied', 'This version is under retention or legal hold.');
      await removeVersion(client, bucketNow, version, 'request');
      for (const region of bucketNow.placement) {
        await queueByteRemoval(client, regionObjectKey(region, bucketNow.name, version.version_id));
      }
    });
    sendNoContent(ctx);
  });

  router.post('/s3/:bucket/*', async (ctx) => {
    const caller = await authenticate(ctx);
    const objectKey = keyFromPath(ctx);
    const bucket = await resolveBucket(caller, ctx, ctx.params.bucket);
    await requireWritable(caller, ctx, objectKey);
    await requireKeyInScope(caller, ctx, objectKey);
    requireNotSuspended(caller);
    if (ctx.query.has('uploads')) {
      await createMultipart(ctx, caller, bucket, objectKey);
      return;
    }
    const uploadId = ctx.query.get('uploadId');
    if (uploadId === null) throw s3Error('NotImplemented');
    await completeMultipart(ctx, caller, bucket, objectKey, uploadId);
  });
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

async function putObject(ctx: Context, caller: S3Caller, bucket: BucketRecord, objectKey: string): Promise<void> {
  const conditions = conditionHeaders(ctx);
  const current = await currentVersion(bucket.name, objectKey);
  if (conditions.ifMatch !== undefined) {
    if (!current) throw s3Error('NoSuchKey');
    if (current.etag !== conditions.ifMatch) throw s3Error('PreconditionFailed');
  }
  if (conditions.ifNoneMatch && current) throw s3Error('PreconditionFailed');

  const declared = declaredDecodedLength(ctx);
  if (declared !== null && declared > limits.singleUpload) throw s3Error('EntityTooLarge');
  if (!isValidObjectKey(objectKey)) throw s3Error('InvalidArgument', "This key can't be stored.");
  const metadata = metadataHeaders(ctx);
  if (!isValidMetadata(metadata)) throw s3Error('MetadataTooLarge');
  const taggingHeader = header(ctx, 'x-amz-tagging');
  const tags = taggingHeader === undefined ? {} : parseTagging(taggingHeader);
  if (tags === null || !isValidTags(tags)) throw s3Error('InvalidTag');
  await quotaCheck(caller, bucket, declared ?? 0);
  if (await regionOffline(bucket)) throw s3Error('SlowDown', 'The origin region is offline.', { 'Retry-After': '30' });

  const body = await readS3Body(ctx, caller.signing, limits.singleUpload);
  const judged = judgeContent(header(ctx, 'content-type'), body.bytes);
  if (judged.scriptedSvg) throw s3Error('InvalidArgument', 'SVG files with scripts are not accepted.');
  await quotaCheck(caller, bucket, body.bytes.length);

  const stored = await transaction(async (client) => {
    await advisoryLock(client, `quota:${bucket.workspace_slug}`);
    await lockKey(client, bucket.name, objectKey);
    const live = await currentVersionIn(client, bucket.name, objectKey);
    if (conditions.ifMatch !== undefined) {
      if (!live) throw s3Error('NoSuchKey');
      if (live.etag !== conditions.ifMatch) throw s3Error('PreconditionFailed');
    }
    if (conditions.ifNoneMatch && live) throw s3Error('PreconditionFailed');
    const bucketNow = (await loadBucketIn(client, bucket.name)) as BucketRecord;
    return storeSingleUpload(client, {
      bucket: bucketNow,
      workspaceSlug: bucket.workspace_slug,
      keyGeneration: caller.keyGeneration,
      key: objectKey,
      bytes: body.bytes,
      contentType: judged.contentType,
      metadata,
      tags,
      checksumAlgorithm: body.checksum?.algorithm ?? null,
      checksumValue: body.checksum?.value ?? null,
      meterRequestUnit: true,
    });
  });
  const headers: Record<string, string> = { ETag: stored.etag, 'x-amz-version-id': stored.version_id };
  if (body.checksum) headers[`x-amz-checksum-${body.checksum.algorithm}`] = body.checksum.value;
  setHeaders(ctx, headers);
  ctx.res.statusCode = 200;
  ctx.res.setHeader('Content-Length', 0);
  ctx.res.end();
}

async function createMultipart(ctx: Context, caller: S3Caller, bucket: BucketRecord, objectKey: string): Promise<void> {
  if (!isValidObjectKey(objectKey)) throw s3Error('InvalidArgument', "This key can't be stored.");
  const metadata = metadataHeaders(ctx);
  if (!isValidMetadata(metadata)) throw s3Error('MetadataTooLarge');
  const taggingHeader = header(ctx, 'x-amz-tagging');
  const tags = taggingHeader === undefined ? {} : parseTagging(taggingHeader);
  if (tags === null || !isValidTags(tags)) throw s3Error('InvalidTag');
  const algorithm = header(ctx, 'x-amz-checksum-algorithm');
  const normalised = algorithm === undefined ? null : algorithm.toLowerCase();
  if (normalised !== null && !['crc32', 'crc32c', 'sha1', 'sha256'].includes(normalised)) {
    throw s3Error('InvalidArgument', 'Unsupported checksum algorithm.');
  }
  const judged = judgeContent(header(ctx, 'content-type'), Buffer.alloc(0));
  const upload = await transaction(async (client) => {
    const bucketNow = (await loadBucketIn(client, bucket.name)) as BucketRecord;
    return createUpload(client, {
      bucket: bucketNow,
      key: objectKey,
      contentType: judged.contentType,
      metadata,
      tags,
      checksumAlgorithm: normalised,
      keyGeneration: caller.keyGeneration,
    });
  });
  const extra = normalised === null ? '' : `<ChecksumAlgorithm>${normalised.toUpperCase()}</ChecksumAlgorithm>`;
  sendXml(
    ctx,
    200,
    `<InitiateMultipartUploadResult><Bucket>${xml(bucket.name)}</Bucket><Key>${xml(objectKey)}</Key><UploadId>${xml(
      upload.upload_id,
    )}</UploadId>${extra}</InitiateMultipartUploadResult>`,
    normalised === null ? {} : { 'x-amz-checksum-algorithm': normalised.toUpperCase() },
  );
}

async function uploadPart(
  ctx: Context,
  caller: S3Caller,
  bucket: BucketRecord,
  objectKey: string,
  uploadId: string,
): Promise<void> {
  const partText = ctx.query.get('partNumber');
  const upload = await findUpload(uploadId);
  if (!upload || upload.state !== 'open' || upload.bucket !== bucket.name || upload.object_key !== objectKey) {
    throw s3Error('NoSuchUpload');
  }
  if (partText === null || !/^\d+$/.test(partText)) throw s3Error('InvalidArgument', 'Part numbers run from 1 to 1,000.');
  const partNumber = Number(partText);
  if (partNumber < 1 || partNumber > 1000) throw s3Error('InvalidArgument', 'Part numbers run from 1 to 1,000.');
  const declared = declaredDecodedLength(ctx);
  if (declared !== null && declared > limits.partMax) throw s3Error('EntityTooLarge');
  await quotaCheck(caller, bucket, declared ?? 0);
  if (await regionOffline(bucket)) throw s3Error('SlowDown', 'The origin region is offline.', { 'Retry-After': '30' });
  const body = await readS3Body(ctx, caller.signing, limits.partMax);
  if (body.checksum !== null && upload.checksum_algorithm !== null && body.checksum.algorithm !== upload.checksum_algorithm) {
    throw s3Error('InvalidArgument', 'The part checksum algorithm differs from the upload.');
  }
  await quotaCheck(caller, bucket, body.bytes.length);
  const result = await transaction(async (client) => {
    await advisoryLock(client, `quota:${bucket.workspace_slug}`);
    const live = await findUploadIn(client, uploadId);
    if (!live || live.state !== 'open') throw s3Error('NoSuchUpload');
    await releaseReservation(client, `res_${uploadId}_${partNumber}`);
    const quota = quotaBytesForPlan(caller.workspacePlan);
    if (quota !== null) {
      const stored = await storedBytesForWorkspace(client, bucket.workspace_slug);
      const reserved = await reservedBytesForWorkspace(client, bucket.workspace_slug);
      const incoming = BigInt(body.bytes.length) * BigInt(bucket.placement.length);
      if (stored + reserved + incoming > BigInt(quota)) throw s3Error('QuotaExceeded');
    }
    await client.query('insert into quota_reservations (id, workspace_slug, bytes, ref) values ($1, $2, $3, $4)', [
      `res_${uploadId}_${partNumber}`,
      bucket.workspace_slug,
      String(BigInt(body.bytes.length) * BigInt(bucket.placement.length)),
      `upload:${uploadId}`,
    ]);
    return storePart(client, live, partNumber, body.bytes, body.checksum);
  });
  const headers: Record<string, string> = { ETag: result.etag };
  if (body.checksum) headers[`x-amz-checksum-${body.checksum.algorithm}`] = body.checksum.value;
  setHeaders(ctx, headers);
  ctx.res.statusCode = 200;
  ctx.res.setHeader('Content-Length', 0);
  ctx.res.end();
}

async function completeMultipart(
  ctx: Context,
  caller: S3Caller,
  bucket: BucketRecord,
  objectKey: string,
  uploadId: string,
): Promise<void> {
  const raw = await readBody(ctx, limits.jsonBody * 16);
  const text = raw.toString('utf8');
  const requested: RequestedPart[] = Array.from(text.matchAll(/<Part>([\s\S]*?)<\/Part>/g)).map((match) => {
    const number = /<PartNumber>([\s\S]*?)<\/PartNumber>/.exec(match[1]);
    const etag = /<ETag>([\s\S]*?)<\/ETag>/.exec(match[1]);
    const checksums: Record<string, string> = {};
    for (const [tag, algorithm] of [
      ['ChecksumCRC32', 'crc32'],
      ['ChecksumCRC32C', 'crc32c'],
      ['ChecksumSHA1', 'sha1'],
      ['ChecksumSHA256', 'sha256'],
    ] as const) {
      const found = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(match[1]);
      if (found) checksums[algorithm] = decodeXml(found[1]);
    }
    return {
      partNumber: number ? Number(decodeXml(number[1])) : 0,
      etag: etag ? decodeXml(etag[1]) : '',
      checksums,
    };
  });

  const upload = await findUpload(uploadId);
  if (!upload || upload.bucket !== bucket.name || upload.object_key !== objectKey) throw s3Error('NoSuchUpload');
  const fingerprint = partListFingerprint(requested);
  if (upload.state === 'completed') {
    if (upload.completed_part_list !== fingerprint) throw s3Error('InvalidPart');
    const stored = upload.completed_response as { etag: string; versionId: string; location: string };
    sendXml(
      ctx,
      200,
      `<CompleteMultipartUploadResult><Location>${xml(stored.location)}</Location><Bucket>${xml(
        bucket.name,
      )}</Bucket><Key>${xml(objectKey)}</Key><ETag>${xml(stored.etag)}</ETag></CompleteMultipartUploadResult>`,
      { 'x-amz-version-id': stored.versionId },
    );
    return;
  }
  if (upload.state !== 'open') throw s3Error('NoSuchUpload');
  if (requested.length === 0) throw s3Error('MalformedXML');

  const conditions = conditionHeaders(ctx);
  if (await regionOffline(bucket)) throw s3Error('SlowDown', 'The origin region is offline.', { 'Retry-After': '30' });

  const version = await transaction(async (client) => {
    await lockKey(client, bucket.name, objectKey);
    const live = await findUploadIn(client, uploadId);
    if (!live || live.state !== 'open') throw s3Error('NoSuchUpload');
    const current = await currentVersionIn(client, bucket.name, objectKey);
    if (conditions.ifMatch !== undefined) {
      if (!current) throw s3Error('NoSuchKey');
      if (current.etag !== conditions.ifMatch) throw s3Error('PreconditionFailed');
    }
    if (conditions.ifNoneMatch && current) throw s3Error('PreconditionFailed');
    const bucketNow = (await loadBucketIn(client, bucket.name)) as BucketRecord;
    const created = await completeUpload(client, bucketNow, live, requested, caller.keyGeneration);
    await markCompleted(client, uploadId, fingerprint, {
      etag: created.etag,
      versionId: created.version_id,
      location: `/s3/${bucket.name}/${objectKey}`,
    });
    return created;
  });
  await discardStagedBytes(uploadId);
  sendXml(
    ctx,
    200,
    `<CompleteMultipartUploadResult><Location>${xml(`/s3/${bucket.name}/${objectKey}`)}</Location><Bucket>${xml(
      bucket.name,
    )}</Bucket><Key>${xml(objectKey)}</Key><ETag>${xml(version.etag)}</ETag></CompleteMultipartUploadResult>`,
    { 'x-amz-version-id': version.version_id },
  );
}

export { requestId };
