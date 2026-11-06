import { sendNoContent, type Req, type Router } from './http.js';
import { one, rows, query, tx } from './db.js';
import { config } from './config.js';
import { parseAuthorization, verifySigV4, signingKey } from './sigv4.js';
import { verifyAccessKey, markKeyUsed, prefixAllows, bucketAllows, permissionAllowsWrite, type KeyRecord } from './access-keys.js';
import {
  sendS3Error, s3Fail, s3UrlEncode, decodeChunked, CHECKSUMS, S3Error, type ChunkMode,
} from './s3-support.js';
import {
  acknowledgeWrite, bucketByName, currentVersion, versionById, plainDelete, removeVersion,
  isLocked, loadPlaintext, recordUsage,
} from './objects.js';
import { isValidKey, tagsFromQuery, validateTags, metadataBytes, judgeContentType, downloadHeaders, SINGLE_UPLOAD_LIMIT } from './api-objects.js';
import { audit } from './audit.js';
import { randomBytes } from 'node:crypto';
import { unseal, opaqueId, sha256Hex, md5Hex, wrapDataKey, workspaceKey, unwrapDataKey, encryptBytes } from './crypto.js';
import { putPart, getPart, deletePartPrefix } from './storage.js';

const PART_MAX = 16_777_216;
const PART_MIN = 5_242_880;
const PART_NUMBERS = 1_000;
const TOTAL_MAX = 1_000_000_000;

function reqId(): string { return opaqueId('r', 8); }

/** x-amz-date uses ISO 8601 basic form, which Date.parse rejects. */
function parseAmzDate(value: string | undefined): number {
  if (value === undefined) return NaN;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (!m) return NaN;
  return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
}

interface S3Ctx {
  key: KeyRecord;
  secret: string;
  usingPrevious: boolean;
  ws: { slug: string; name: string; status: string };
}

function throwS3(f: S3Error): never {
  throw f;
}

/** Authenticates the SigV4 request and loads the key's workspace. */
async function auth(req: Req, rawBody: Buffer, payloadShaOverride?: string): Promise<S3Ctx> {
  const header = req.headers['authorization'];
  if (!header) throwS3(s3Fail(403, 'AccessDenied', 'Anonymous access is not allowed.'));
  const parts = parseAuthorization(header);
  if (!parts) throwS3(s3Fail(403, 'AccessDenied', 'The authorization header is malformed.'));
  if (parts.service !== 's3') throwS3(s3Fail(403, 'AccessDenied', 'Only the s3 service is supported.'));
  const rec = await verifyAccessKey(parts.accessKeyId);
  if (!rec) throwS3(s3Fail(403, 'InvalidAccessKeyId', 'The access key is unknown or not usable.'));
  const t = parseAmzDate(req.headers['x-amz-date']);
  if (Number.isNaN(t) || Math.abs(t - Date.now()) > 15 * 60 * 1000) {
    throwS3(s3Fail(403, 'RequestTimeTooSkewed', 'The request time is too far from the server time.'));
  }
  const payloadSha = payloadShaOverride ?? req.headers['x-amz-content-sha256'] ?? 'UNSIGNED-PAYLOAD';
  const declared = payloadSha !== 'UNSIGNED-PAYLOAD' && /^[0-9a-f]{64}$/.test(payloadSha) ? payloadSha : null;
  const actual = sha256Hex(rawBody);
  if (declared !== null && declared !== actual) {
    throwS3(s3Fail(400, 'BadDigest', 'The payload hash does not match the body.'));
  }
  const ok = verifySigV4(parts, rec.secret, req.method, req.rawPath, req.query, req.headers, declared ?? actual);
  if (!ok && rec.usingPrevious === false) {
    // A key whose current secret did not verify might be signed with the previous secret.
    const alt = await verifyAccessKeyPrevious(parts.accessKeyId);
    if (alt) {
      const okPrev = verifySigV4(parts, alt.secret, req.method, req.rawPath, req.query, req.headers, declared ?? actual);
      if (okPrev) {
        await markKeyUsed(parts.accessKeyId, true);
        const ws = await one<{ slug: string; name: string; status: string }>(`SELECT slug, name, status FROM workspaces WHERE slug = $1`, [alt.key.workspace_slug]);
        return { key: alt.key, secret: alt.secret, usingPrevious: true, ws: ws! };
      }
    }
    throwS3(s3Fail(403, 'SignatureDoesNotMatch', 'The request signature does not match.'));
  }
  if (!ok) throwS3(s3Fail(403, 'SignatureDoesNotMatch', 'The request signature does not match.'));
  await markKeyUsed(parts.accessKeyId, rec.usingPrevious);
  const ws = await one<{ slug: string; name: string; status: string }>(`SELECT slug, name, status FROM workspaces WHERE slug = $1`, [rec.key.workspace_slug]);
  return { key: rec.key, secret: rec.secret, usingPrevious: rec.usingPrevious, ws: ws! };
}

async function verifyAccessKeyPrevious(keyId: string): Promise<{ key: KeyRecord; secret: string } | null> {
  const rec = await verifyAccessKey(keyId);
  if (!rec || !rec.key.sealed_prev_secret) return null;
  const prev = await one<{ sealed_prev_secret: string; prev_expires_at: Date | null }>(
    `SELECT sealed_prev_secret, prev_expires_at FROM access_keys WHERE key_id = $1`, [keyId]
  );
  if (!prev?.sealed_prev_secret) return null;
  if (prev.prev_expires_at !== null && prev.prev_expires_at.getTime() <= Date.now()) return null;
  const secret = unseal(config.secretKey, prev.sealed_prev_secret);
  if (secret === null) return null;
  return { key: rec.key, secret };
}



/** Loads the named bucket, deciding AccessDenied for other workspaces and NoSuchBucket for unknown ones. */
async function s3Bucket(bucketName: string, ctx: S3Ctx): Promise<NonNullable<Awaited<ReturnType<typeof bucketByName>>>> {
  const b = await bucketByName(bucketName);
  if (!b) throwS3(s3Fail(404, 'NoSuchBucket', 'The bucket does not exist.'));
  if (b.workspace_slug !== ctx.ws.slug) {
    await audit(ctx.ws.slug, `key:${ctx.key.key_id}`, 'permission.denied', bucketName, `${'S3'} /s3/${bucketName}`);
    throwS3(s3Fail(403, 'AccessDenied', 'The bucket is not accessible with this key.'));
  }
  if (!bucketAllows(ctx.key.buckets, bucketName)) {
    await audit(ctx.ws.slug, `key:${ctx.key.key_id}`, 'permission.denied', bucketName, `S3 /s3/${bucketName}`);
    throwS3(s3Fail(403, 'AccessDenied', "The bucket is outside this key's scope."));
  }
  return b;
}

function s3KeyParam(req: Req): string {
  return req.params['**'] ?? '';
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function xmlResponse(res: import('node:http').ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/xml', 'Content-Length': Buffer.byteLength(body), ...headers });
  res.end(body);
}

/** Resolves the request's payload into decoded bytes, honouring chunked modes and checksums. */
async function resolveBody(req: Req, ctx: S3Ctx, rawBody: Buffer, forOperation: 'PutObject' | 'UploadPart' | 'other'): Promise<{ bytes: Buffer; checksumAlgo: string | null; checksumValue: string | null } | S3Error> {
  const shaMode = req.headers['x-amz-content-sha256'] ?? '';
  const contentEncoding = (req.headers['content-encoding'] ?? '').toLowerCase();
  const chunked = contentEncoding.includes('aws-chunked') || shaMode.startsWith('STREAMING-');
  if (shaMode === 'STREAMING-AWS4-HMAC-SHA256-PAYLOAD-TRAILER' ||
      shaMode === 'STREAMING-AWS4-ECDSA-P256-SHA256-PAYLOAD' ||
      shaMode === 'STREAMING-AWS4-ECDSA-P256-SHA256-PAYLOAD-TRAILER') {
    return s3Fail(501, 'NotImplemented', "This payload mode is not supported.");
  }
  if (shaMode.startsWith('STREAMING-') && forOperation === 'other') {
    return s3Fail(400, 'InvalidArgument', "Chunked bodies are only allowed on PutObject and UploadPart.");
  }
  const declared = req.headers['x-amz-decoded-content-length'];
  if (chunked && (declared === undefined || !/^\d+$/.test(declared))) {
    return s3Fail(400, 'InvalidArgument', "x-amz-decoded-content-length is required for aws-chunked bodies.");
  }
  let mode: ChunkMode = { kind: 'plain' };
  if (shaMode === 'STREAMING-AWS4-HMAC-SHA256-PAYLOAD') {
    const header = req.headers['authorization'] ?? '';
    const parts = parseAuthorization(header);
    if (!parts) return s3Fail(403, 'SignatureDoesNotMatch', 'The request signature does not match.');
    mode = { kind: 'signed', signingKey: signingKey(ctx.secret, parts.credentialDate, parts.region, parts.service), date: req.headers['x-amz-date'] ?? '', scope: `${parts.credentialDate}/${parts.region}/${parts.service}/aws4_request`, headerSignature: parts.signature };
  } else if (shaMode === 'STREAMING-UNSIGNED-PAYLOAD-TRAILER') {
    const trailer = (req.headers['x-amz-trailer'] ?? '').trim().toLowerCase();
    if (!CHECKSUMS[trailer.replace('x-amz-checksum-', '')]) {
      return s3Fail(400, 'InvalidArgument', "The trailer must name a supported checksum.");
    }
    mode = { kind: 'trailer', trailerName: trailer };
  }
  const decodedLength = declared !== undefined ? Number(declared) : null;
  let out: { bytes: Buffer; trailerChecksum?: { algo: string; value: string }; error?: { code: string; status: number; message: string } };
  if (!chunked) {
    out = { bytes: rawBody };
  } else {
    out = decodeChunked(rawBody, decodedLength, mode);
    if (out.error) return s3Fail(out.error.status, out.error.code, out.error.message);
  }
  const bytes = out.bytes;
  if (forOperation !== 'other' && bytes.length > (forOperation === 'PutObject' ? SINGLE_UPLOAD_LIMIT : PART_MAX)) {
    return s3Fail(413, 'EntityTooLarge', "The payload is over the limit.");
  }

  // Checksums: header, or trailer for the trailer mode.
  let algo: string | null = null;
  let value: string | null = null;
  const headerAlgos = Object.keys(CHECKSUMS).filter(a => req.headers[`x-amz-checksum-${a}`] !== undefined);
  if (headerAlgos.length > 1) return s3Fail(400, 'InvalidArgument', "Only one checksum may be given.");
  if (headerAlgos.length === 1) {
    algo = headerAlgos[0];
    value = req.headers[`x-amz-checksum-${algo}`] ?? '';
  } else if (out.trailerChecksum) {
    algo = out.trailerChecksum.algo.replace('x-amz-checksum-', '');
    value = out.trailerChecksum.value;
  }
  if (algo !== null) {
    const digest = CHECKSUMS[algo]?.digest(bytes);
    const expected = digest ? digest.toString('base64') : '';
    const len = { crc32: 4, crc32c: 4, sha1: 20, sha256: 32 }[algo] ?? 0;
    if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return s3Fail(400, 'InvalidArgument', "The checksum value is not valid base64.");
    try {
      const decodedVal = Buffer.from(value, 'base64');
      if (decodedVal.length !== len) return s3Fail(400, 'InvalidArgument', "The checksum value has the wrong length.");
    } catch {
      return s3Fail(400, 'InvalidArgument', "The checksum value is not valid base64.");
    }
    if (value !== expected) return s3Fail(400, 'BadDigest', "The checksum does not match the payload.");
  }
  const contentMd5 = req.headers['content-md5'];
  if (contentMd5 !== undefined) {
    try {
      const expectedMd5 = Buffer.from(contentMd5, 'base64').toString('hex') === md5Hex(bytes);
      if (!expectedMd5) return s3Fail(400, 'BadDigest', "The Content-MD5 does not match.");
    } catch {
      return s3Fail(400, 'BadDigest', "The Content-MD5 does not match.");
    }
  }
  return { bytes, checksumAlgo: algo, checksumValue: value };
}

function isFail(x: unknown): x is S3Error {
  return x instanceof S3Error;
}

export function registerS3Routes(s3: Router): void {
  // ---- PutObject ----
  s3.put('/s3/{bucket}/**', async (req, res) => {
    const raw = req.rawBody ?? Buffer.alloc(0);
    if (req.query.get('uploadId') !== null && req.query.get('partNumber') !== null) {
      await uploadPart(req, res, raw);
      return;
    }
    const ctx = await auth(req, raw);
    const bucket = await s3Bucket(req.params['bucket'], ctx);
    if (ctx.ws.status === 'suspended') throwS3(s3Fail(403, 'AccountSuspended', 'The workspace is suspended.'));
    if (!permissionAllowsWrite(ctx.key.permission)) {
      await audit(ctx.ws.slug, `key:${ctx.key.key_id}`, 'permission.denied', bucket.name, `PUT /s3/${bucket.name}`);
      throwS3(s3Fail(403, 'AccessDenied', 'This key is read only.'));
    }
    const key = s3KeyParam(req);
    if (!prefixAllows(ctx.key.prefix, key)) {
      await audit(ctx.ws.slug, `key:${ctx.key.key_id}`, 'permission.denied', key, `PUT /s3/${bucket.name}/${key}`);
      throwS3(s3Fail(403, 'AccessDenied', "This key is outside the key's prefix."));
    }
    if (!isValidKey(key)) throwS3(s3Fail(400, 'InvalidArgument', "This key can't be stored."));
    const ifMatch = req.headers['if-match'];
    const ifNoneMatch = req.headers['if-none-match'];
    const cur0 = await currentVersion(bucket.name, key);
    if (ifMatch !== undefined) {
      if (!cur0) throwS3(s3Fail(404, 'NoSuchKey', 'The key does not exist.'));
      if (cur0.etag !== ifMatch) throwS3(s3Fail(412, 'PreconditionFailed', 'The precondition failed.'));
    }
    if (ifNoneMatch !== undefined && cur0) throwS3(s3Fail(412, 'PreconditionFailed', 'The precondition failed.'));

    // Quota check before reading the body.
    const plan = await one<{ storage_overage: string; included_storage_bytes: string }>(
      `SELECT p.storage_overage, p.included_storage_bytes::text AS included_storage_bytes FROM plans p JOIN workspaces w ON w.plan = p.id WHERE w.slug = $1`, [ctx.ws.slug]);
    const capped = plan?.storage_overage === 'none';
    const incoming = req.headers['x-amz-decoded-content-length'] !== undefined
      ? Number(req.headers['x-amz-decoded-content-length'])
      : (req.headers['content-length'] ? Number(req.headers['content-length']) : raw.length);
    if (capped) {
      const placed = bucket.placement.length;
      const allowed = await checkQuota(ctx.ws.slug, incoming * placed, Number(plan!.included_storage_bytes));
      if (!allowed) throwS3(s3Fail(403, 'QuotaExceeded', 'The storage quota is exceeded.'));
    }

    const bodyResult = await resolveBody(req, ctx, raw, 'PutObject');
    if (isFail(bodyResult)) { sendS3Error(res, bodyResult.s3status, bodyResult.s3code, bodyResult.message, `/${bucket.name}/${key}`, reqId(), bodyResult.s3extra ?? {}); return; }
    const meta: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (k.startsWith('x-amz-meta-')) meta[k.slice('x-amz-meta-'.length)] = v;
    }
    if (metadataBytes(meta) > 2048) throwS3(s3Fail(400, 'MetadataTooLarge', 'User metadata is limited to 2,048 bytes in total.'));
    const tags = tagsFromQuery(req.headers['x-amz-tagging']);
    const tagErr = validateTags(tags);
    if (tagErr) throwS3(s3Fail(400, 'InvalidTag', tagErr));
    const judged = judgeContentType(bodyResult.bytes, req.headers['content-type'] ?? 'application/octet-stream');
    if (judged.refuse) throwS3(s3Fail(400, 'InvalidArgument', 'SVG files with scripts are not accepted.'));
    const regionRow = await one<{ state: string }>(`SELECT state FROM regions WHERE id = $1`, [bucket.placement[0]]);
    if (regionRow?.state === 'offline') {
      throwS3(s3Fail(503, 'SlowDown', 'The origin region is offline.', { 'Retry-After': '30' }));
    }
    const created = await acknowledgeWrite({
      bucket: bucket.name, key, bytes: bodyResult.bytes, contentType: judged.type,
      metadata: meta, tags, checksumAlgo: bodyResult.checksumAlgo, checksumValue: bodyResult.checksumValue,
    });
    const headers: Record<string, string> = { ETag: created.etag, 'x-amz-version-id': created.version_id };
    if (bodyResult.checksumAlgo) headers[`x-amz-checksum-${bodyResult.checksumAlgo}`] = bodyResult.checksumValue ?? '';
    res.writeHead(200, headers);
    res.end();
  });

  // ---- GetObject / HeadObject ----
  const getObject = async (req: Req, res: import('node:http').ServerResponse, head: boolean): Promise<void> => {
    const raw = Buffer.alloc(0);
    const ctx = await auth(req, raw, req.headers['x-amz-content-sha256'] === undefined ? sha256Hex(Buffer.alloc(0)) : undefined);
    const bucket = await s3Bucket(req.params['bucket'], ctx);
    if (ctx.ws.status === 'suspended') throwS3(s3Fail(403, 'AccountSuspended', 'The workspace is suspended.'));
    const key = s3KeyParam(req);
    if (!prefixAllows(ctx.key.prefix, key)) {
      await audit(ctx.ws.slug, `key:${ctx.key.key_id}`, 'permission.denied', key, `${head ? 'HEAD' : 'GET'} /s3/${bucket.name}/${key}`);
      throwS3(s3Fail(403, 'AccessDenied', "This key is outside the key's prefix."));
    }
    const versionId = req.query.get('versionId');
    const v = versionId ? await versionById(versionId) : await currentVersion(bucket.name, key);
    if (!v || v.state === 'removed' || (versionId && (v.bucket_name !== bucket.name || v.key !== key))) {
      throwS3(s3Fail(404, 'NoSuchKey', 'The key does not exist.'));
    }
    let bytes = Buffer.alloc(0) as Buffer<ArrayBufferLike>;
    if (!head) {
      bytes = await loadPlaintext(v);
      await tx(async client => { await recordUsage(client, ctx.ws.slug, bucket.name, 'egress-gb', bytes.length, new Date()); });
      await tx(async client => { await recordUsage(client, ctx.ws.slug, bucket.name, 'request-units', 1, new Date()); });
    }
    const headers: Record<string, string> = {
      ETag: v.etag,
      'x-amz-version-id': v.version_id,
      'Last-Modified': v.acknowledged_at.toUTCString(),
      'Content-Length': String(v.size),
      'Content-Type': v.content_type,
      'x-amz-tagging-count': String(Object.keys(v.tags).length),
    };
    for (const [mk, mv] of Object.entries(v.metadata)) headers[`x-amz-meta-${mk}`] = mv;
    if (req.headers['x-amz-checksum-mode']?.toUpperCase() === 'ENABLED' && v.checksum_algo && v.checksum_value && !v.part_count) {
      headers[`x-amz-checksum-${v.checksum_algo}`] = v.checksum_value;
    }
    if (!head) Object.assign(headers, downloadHeaders(key, v.content_type, false));
    res.writeHead(200, headers);
    res.end(head ? undefined : bytes);
  };
  s3.get('/s3/{bucket}/**', async (req, res) => { await getObject(req, res, req.method === 'HEAD'); });
  s3.head('/s3/{bucket}/**', async (req, res) => { await getObject(req, res, true); });

  // ---- DeleteObject ----
  s3.delete('/s3/{bucket}/**', async (req, res) => {
    const raw = Buffer.alloc(0);
    const uploadId = req.query.get('uploadId');
    const ctx = await auth(req, raw);
    const bucket = await s3Bucket(req.params['bucket'], ctx);
    if (ctx.ws.status === 'suspended') throwS3(s3Fail(403, 'AccountSuspended', 'The workspace is suspended.'));
    if (!permissionAllowsWrite(ctx.key.permission)) {
      await audit(ctx.ws.slug, `key:${ctx.key.key_id}`, 'permission.denied', bucket.name, `DELETE /s3/${bucket.name}`);
      throwS3(s3Fail(403, 'AccessDenied', 'This key is read only.'));
    }
    const key = s3KeyParam(req);
    if (!prefixAllows(ctx.key.prefix, key)) {
      await audit(ctx.ws.slug, `key:${ctx.key.key_id}`, 'permission.denied', key, `DELETE /s3/${bucket.name}/${key}`);
      throwS3(s3Fail(403, 'AccessDenied', "This key is outside the key's prefix."));
    }
    if (uploadId !== null) {
      await abortMultipart(req, res, bucket.name, key, uploadId, ctx);
      return;
    }
    const versionId = req.query.get('versionId');
    if (versionId === null) {
      const cur = await currentVersion(bucket.name, key);
      if (cur) await plainDelete(bucket.name, key, { ws: ctx.ws.slug });
      sendNoContent(res);
      return;
    }
    const v = await versionById(versionId);
    if (!v || v.state === 'removed' || v.bucket_name !== bucket.name || v.key !== key) { sendNoContent(res); return; }
    if (v.state === 'current') throwS3(s3Fail(400, 'InvalidArgument', "The current version cannot be removed directly."));
    if (isLocked(v)) throwS3(s3Fail(403, 'AccessDenied', "This version is under retention or legal hold."));
    await removeVersion(v, 'request', true);
    sendNoContent(res);
  });

  // ---- Bucket-level POST: DeleteObjects and CreateMultipartUpload ----
  s3.post('/s3/{bucket}', async (req, res) => {
    const raw = req.rawBody ?? Buffer.alloc(0);
    const ctx = await auth(req, raw);
    const bucket = await s3Bucket(req.params['bucket'], ctx);
    if (ctx.ws.status === 'suspended') throwS3(s3Fail(403, 'AccountSuspended', 'The workspace is suspended.'));
    if (!permissionAllowsWrite(ctx.key.permission)) {
      await audit(ctx.ws.slug, `key:${ctx.key.key_id}`, 'permission.denied', bucket.name, `POST /s3/${bucket.name}`);
      throwS3(s3Fail(403, 'AccessDenied', 'This key is read only.'));
    }
    if (req.query.get('delete') !== null) {
      await deleteObjects(req, res, raw, bucket, ctx);
      return;
    }
    throwS3(s3Fail(501, 'NotImplemented', 'This operation is not supported at the bucket level.'));
  });

  // ---- Multipart: create via POST with ?uploads on a key path ----
  s3.post('/s3/{bucket}/**', async (req, res) => {
    const raw = req.rawBody ?? Buffer.alloc(0);
    if (req.query.get('uploads') === null && req.query.get('uploadId') === null) {
      throwS3(s3Fail(501, 'NotImplemented', 'This operation is not supported.'));
    }
    const ctx = await auth(req, raw);
    const bucket = await s3Bucket(req.params['bucket'], ctx);
    if (ctx.ws.status === 'suspended') throwS3(s3Fail(403, 'AccountSuspended', 'The workspace is suspended.'));
    if (!permissionAllowsWrite(ctx.key.permission)) {
      await audit(ctx.ws.slug, `key:${ctx.key.key_id}`, 'permission.denied', bucket.name, `POST /s3/${bucket.name}`);
      throwS3(s3Fail(403, 'AccessDenied', 'This key is read only.'));
    }
    const key = s3KeyParam(req);
    if (!prefixAllows(ctx.key.prefix, key)) {
      await audit(ctx.ws.slug, `key:${ctx.key.key_id}`, 'permission.denied', key, `POST /s3/${bucket.name}/${key}`);
      throwS3(s3Fail(403, 'AccessDenied', "This key is outside the key's prefix."));
    }
    if (req.query.get('uploadId') !== null) {
      await completeMultipart(req, res, raw, bucket, key, req.query.get('uploadId')!, ctx);
      return;
    }
    if (!isValidKey(key)) throwS3(s3Fail(400, 'InvalidArgument', "This key can't be stored."));
    const algo = req.headers['x-amz-checksum-algorithm']?.toLowerCase() ?? null;
    if (algo !== null && !CHECKSUMS[algo]) throwS3(s3Fail(400, 'InvalidArgument', 'The checksum algorithm is not supported.'));
    const uploadId = opaqueId('up', 16);
    const wsRow = await one<{ key_generation: number }>(`SELECT key_generation FROM workspaces WHERE slug = $1`, [ctx.ws.slug]);
    const generation = wsRow?.key_generation ?? 1;
    const wk = workspaceKey(config.secretKey, ctx.ws.slug, generation);
    const dataKey = randomBytes(32);
    await query(
      `INSERT INTO multipart_uploads (upload_id, bucket_name, key, checksum_algo, wrapped_key, key_generation)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [uploadId, bucket.name, key, algo, wrapDataKey(wk, dataKey), generation]
    );
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<InitiateMultipartUploadResult><Bucket>${xmlEscape(bucket.name)}</Bucket><Key>${xmlEscape(key)}</Key><UploadId>${uploadId}</UploadId>${algo ? `<ChecksumAlgorithm>${CHECKSUMS[algo].name}</ChecksumAlgorithm>` : ''}</InitiateMultipartUploadResult>`;
    const headers: Record<string, string> = {};
    if (algo) headers[`x-amz-checksum-algorithm`] = CHECKSUMS[algo].name;
    xmlResponse(res, 200, body, headers);
  });

  // ---- ListObjectsV2 ----
  s3.get('/s3/{bucket}', async (req, res) => {
    const raw = Buffer.alloc(0);
    const ctx = await auth(req, raw, req.headers['x-amz-content-sha256'] === undefined ? sha256Hex(Buffer.alloc(0)) : undefined);
    const bucket = await s3Bucket(req.params['bucket'], ctx);
    if (req.query.get('list-type') !== '2') throwS3(s3Fail(501, 'NotImplemented', 'Only ListObjectsV2 is supported.'));
    const keyPrefix = ctx.key.prefix;
    const listPrefix = req.query.get('prefix') ?? '';
    if (keyPrefix !== null && (listPrefix === '' || !listPrefix.startsWith(keyPrefix))) {
      await audit(ctx.ws.slug, `key:${ctx.key.key_id}`, 'permission.denied', bucket.name, `GET /s3/${bucket.name}`);
      throwS3(s3Fail(403, 'AccessDenied', "This key can only list under its prefix."));
    }
    let maxKeys = 1000;
    const mk = req.query.get('max-keys');
    if (mk !== null) {
      const n = Number(mk);
      if (!Number.isInteger(n) || n < 0) throwS3(s3Fail(400, 'InvalidArgument', 'max-keys must be a non-negative integer.'));
      maxKeys = Math.min(n, 1000);
    }
    const delimiter = req.query.get('delimiter') ?? '';
    const encoding = req.query.get('encoding-type');
    if (encoding !== null && encoding !== 'url') throwS3(s3Fail(400, 'InvalidArgument', 'Only url encoding is supported.'));
    const continuation = req.query.get('continuation-token');
    const startAfter = req.query.get('start-after') ?? '';
    let after = startAfter;
    if (continuation !== null) {
      try {
        const decoded = JSON.parse(Buffer.from(continuation, 'base64url').toString('utf8'));
        if (typeof decoded?.after !== 'string') throw new Error();
        after = decoded.after;
      } catch {
        throwS3(s3Fail(400, 'InvalidArgument', 'The continuation token is not valid.'));
      }
    }
    // Gather the page, merging common prefixes in key order.
    const items: Array<{ key: string; lastModified: Date; etag: string; size: string }> = [];
    const common: string[] = [];
    let lastKey = after;
    let truncated = false;
    const scan = await rows<{ key: string; version_id: string; etag: string; size: string; last_modified: Date; tags: Record<string, string> }>(
      `SELECT key, version_id, etag, size::text AS size, acknowledged_at AS last_modified, tags
       FROM versions WHERE bucket_name = $1 AND state = 'current' AND key > $2 ORDER BY key ASC LIMIT 2000`,
      [bucket.name, after ?? '']
    );
    void lastKey;
    for (const row of scan) {
      if (listPrefix && !row.key.startsWith(listPrefix)) continue;
      if (items.length + common.length >= maxKeys) { truncated = scan.indexOf(row) < scan.length - 1 || scan.length === 2000; break; }
      if (delimiter) {
        const rest = row.key.slice(listPrefix.length);
        const idx = rest.indexOf(delimiter);
        if (idx >= 0) {
          const cp = listPrefix + rest.slice(0, idx + delimiter.length);
          if (common.length === 0 || common[common.length - 1] !== cp) common.push(cp);
          continue;
        }
      }
      items.push({ key: row.key, lastModified: row.last_modified, etag: row.etag, size: row.size });
    }
    const lastItem = items.length > 0 ? items[items.length - 1].key : null;
    const nextToken = truncated ? Buffer.from(JSON.stringify({ after: lastItem ?? after })).toString('base64url') : null;
    const enc = (s: string) => encoding === 'url' ? s3UrlEncode(s) : xmlEscape(s);
    let body = `<?xml version="1.0" encoding="UTF-8"?>\n<ListBucketResult>`;
    body += `<Name>${xmlEscape(bucket.name)}</Name><Prefix>${enc(listPrefix)}</Prefix>`;
    body += delimiter ? `<Delimiter>${enc(delimiter)}</Delimiter>` : '';
    body += `<MaxKeys>1000</MaxKeys><KeyCount>${items.length + common.length}</KeyCount><IsTruncated>${truncated}</IsTruncated>`;
    if (continuation !== null) body += `<ContinuationToken>${xmlEscape(continuation)}</ContinuationToken>`;
    if (startAfter) body += `<StartAfter>${enc(startAfter)}</StartAfter>`;
    if (nextToken) body += `<NextContinuationToken>${xmlEscape(nextToken)}</NextContinuationToken>`;
    if (encoding === 'url') body += `<EncodingType>url</EncodingType>`;
    // merge keys and prefixes in byte order
    const merged: Array<{ kind: 'key' | 'cp'; value: string; item?: typeof items[number] }> = [];
    let ci = 0;
    for (const it of items) {
      while (ci < common.length && common[ci] < it.key) { merged.push({ kind: 'cp', value: common[ci] }); ci++; }
      merged.push({ kind: 'key', value: it.key, item: it });
    }
    while (ci < common.length) { merged.push({ kind: 'cp', value: common[ci] }); ci++; }
    for (const m of merged) {
      if (m.kind === 'cp') body += `<CommonPrefixes><Prefix>${enc(m.value)}</Prefix></CommonPrefixes>`;
      else body += `<Contents><Key>${enc(m.value)}</Key><LastModified>${m.item!.lastModified.toISOString()}</LastModified><ETag>${xmlEscape(m.item!.etag)}</ETag><Size>${m.item!.size}</Size><StorageClass>STANDARD</StorageClass></Contents>`;
    }
    body += `</ListBucketResult>`;
    xmlResponse(res, 200, body);
  });
}

async function checkQuota(ws: string, incoming: number, quotaBytes: number): Promise<boolean> {
  const sums = await one<{ stored: string; reserved: string }>(
    `SELECT COALESCE((SELECT SUM(stored_bytes) FROM buckets WHERE workspace_slug = $1),0)::text AS stored,
            COALESCE((SELECT SUM(bytes) FROM quota_reservations WHERE workspace_slug = $1),0)::text AS reserved`, [ws]
  );
  return BigInt(sums!.stored) + BigInt(sums!.reserved) + BigInt(incoming) <= BigInt(quotaBytes);
}

async function uploadPart(req: Req, res: import('node:http').ServerResponse, raw: Buffer): Promise<void> {
  const ctx = await auth(req, raw);
  const bucket = await s3Bucket(req.params['bucket'], ctx);
  if (ctx.ws.status === 'suspended') throwS3(s3Fail(403, 'AccountSuspended', 'The workspace is suspended.'));
  if (!permissionAllowsWrite(ctx.key.permission)) throwS3(s3Fail(403, 'AccessDenied', 'This key is read only.'));
  const key = s3KeyParam(req);
  if (!prefixAllows(ctx.key.prefix, key)) throwS3(s3Fail(403, 'AccessDenied', "This key is outside the key's prefix."));
  const uploadId = req.query.get('uploadId')!;
  const partNumber = Number(req.query.get('partNumber'));
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > PART_NUMBERS) {
    throwS3(s3Fail(400, 'InvalidArgument', 'Part numbers run from 1 to 1,000.'));
  }
  const upload = await one<{ bucket_name: string; key: string; checksum_algo: string | null; wrapped_key: string; key_generation: number }>(
    `SELECT bucket_name, key, checksum_algo, wrapped_key, key_generation FROM multipart_uploads WHERE upload_id = $1`, [uploadId]
  );
  if (!upload || upload.bucket_name !== bucket.name || upload.key !== key) throwS3(s3Fail(404, 'NoSuchUpload', 'The upload does not exist.'));
  const plan = await one<{ storage_overage: string; included_storage_bytes: string }>(
    `SELECT p.storage_overage, p.included_storage_bytes::text AS included_storage_bytes FROM plans p JOIN workspaces w ON w.plan = p.id WHERE w.slug = $1`, [ctx.ws.slug]);
  const capped = plan?.storage_overage === 'none';
  const incoming = req.headers['x-amz-decoded-content-length'] !== undefined
    ? Number(req.headers['x-amz-decoded-content-length'])
    : (req.headers['content-length'] ? Number(req.headers['content-length']) : raw.length);
  const placed = bucket.placement.length;
  if (capped) {
    const existing = await one<{ bytes: string }>(
      `SELECT COALESCE(bytes,0)::text AS bytes FROM quota_reservations WHERE workspace_slug = $1 AND upload_id = $2 AND part_number = $3`,
      [ctx.ws.slug, uploadId, partNumber]
    );
    const minus = existing ? BigInt(existing.bytes) : 0n;
    const sums = await one<{ stored: string; reserved: string }>(
      `SELECT COALESCE((SELECT SUM(stored_bytes) FROM buckets WHERE workspace_slug = $1),0)::text AS stored,
              COALESCE((SELECT SUM(bytes) FROM quota_reservations WHERE workspace_slug = $1),0)::text AS reserved`, [ctx.ws.slug]
    );
    const total = BigInt(sums!.stored) + BigInt(sums!.reserved) - minus + BigInt(incoming * placed);
    if (total > BigInt(plan!.included_storage_bytes)) throwS3(s3Fail(403, 'QuotaExceeded', 'The storage quota is exceeded.'));
  }
  const bodyResult = await resolveBody(req, ctx, raw, 'UploadPart');
  if (isFail(bodyResult)) { sendS3Error(res, bodyResult.s3status, bodyResult.s3code, bodyResult.message, `/${bucket.name}/${key}`, reqId()); return; }
  if (upload.checksum_algo && bodyResult.checksumAlgo && upload.checksum_algo !== bodyResult.checksumAlgo) {
    throwS3(s3Fail(400, 'InvalidArgument', "The part checksum algorithm differs from the upload."));
  }
  const partEtag = '"' + md5Hex(bodyResult.bytes) + '"';
  await putPart(uploadId, partNumber, encryptPart(upload.wrapped_key, upload.key_generation, ctx.ws.slug, bodyResult.bytes));
  await tx(async client => {
    await client.query(
      `INSERT INTO upload_parts (upload_id, part_number, etag, size, checksum_value)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (upload_id, part_number) DO UPDATE SET etag = $3, size = $4, checksum_value = $5`,
      [uploadId, partNumber, partEtag, bodyResult.bytes.length, bodyResult.checksumValue]
    );
    if (capped) {
      await client.query(
        `INSERT INTO quota_reservations (workspace_slug, upload_id, part_number, bytes) VALUES ($1,$2,$3,$4)
         ON CONFLICT (workspace_slug, upload_id, part_number) DO UPDATE SET bytes = $4`,
        [ctx.ws.slug, uploadId, partNumber, incoming * placed]
      );
    }
  });
  const headers: Record<string, string> = { ETag: partEtag };
  if (bodyResult.checksumAlgo) headers[`x-amz-checksum-${bodyResult.checksumAlgo}`] = bodyResult.checksumValue ?? '';
  res.writeHead(200, headers);
  res.end();
}

/** Part bytes are stored only as ciphertext under the upload's data key. */
function encryptPart(wrappedKey: string, generation: number, wsSlug: string, bytes: Buffer): Buffer {
  const wk = workspaceKey(config.secretKey, wsSlug, generation);
  const dk = unwrapDataKey(wk, wrappedKey);
  if (!dk) throwS3(s3Fail(500, 'InternalError', 'The data key could not be unwrapped.'));
  return encryptBytes(dk, bytes);
}

async function completeMultipart(
  req: Req, res: import('node:http').ServerResponse, raw: Buffer,
  bucket: Awaited<ReturnType<typeof bucketByName>>, key: string, uploadId: string, ctx: S3Ctx,
): Promise<void> {
  const upload = await one<{ bucket_name: string; key: string; checksum_algo: string | null; wrapped_key: string; key_generation: number; complete_result: unknown }>(
    `SELECT bucket_name, key, checksum_algo, wrapped_key, key_generation, complete_result FROM multipart_uploads WHERE upload_id = $1`, [uploadId]
  );
  if (!upload || upload.bucket_name !== bucket!.name || upload.key !== key) throwS3(s3Fail(404, 'NoSuchUpload', 'The upload does not exist.'));
  if (upload.complete_result) {
    const stored = upload.complete_result as { status: number; body: string; etag: string; version_id: string };
    res.writeHead(stored.status, { ETag: stored.etag, 'x-amz-version-id': stored.version_id });
    res.end(stored.body);
    return;
  }
  let entries: Array<{ part: number; etag: string; checksum?: string }> = [];
  try {
    const xml = raw.toString('utf8');
    const partRe = /<Part>([\s\S]*?)<\/Part>/g;
    let m: RegExpExecArray | null;
    while ((m = partRe.exec(xml)) !== null) {
      const seg = m[1];
      const part = Number(/<PartNumber>(\d+)<\/PartNumber>/.exec(seg)?.[1]);
      const etag = /<ETag>([^<]*)<\/ETag>/.exec(seg)?.[1] ?? '';
      const checksum = /<Checksum(CRC32|CRC32C|SHA1|SHA256)>([^<]*)<\/Checksum\1>/.exec(seg)?.[2];
      entries.push({ part, etag, checksum });
    }
    if (entries.length === 0) throwS3(s3Fail(400, 'MalformedXML', "The XML could not be read."));
  } catch (e) {
    if (e instanceof S3Error) throw e;
    throwS3(s3Fail(400, 'MalformedXML', "The XML could not be read."));
  }
  // ascending order
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].part <= entries[i - 1].part) throwS3(s3Fail(400, 'InvalidPartOrder', "The parts must be listed in ascending order."));
  }
  const parts = await rows<{ part_number: number; etag: string; size: string; checksum_value: string | null }>(
    `SELECT part_number, etag, size::text AS size, checksum_value FROM upload_parts WHERE upload_id = $1 ORDER BY part_number ASC`, [uploadId]
  );
  const byNumber = new Map(parts.map(p => [p.part_number, p]));
  let totalSize = 0;
  const partMd5s: string[] = [];
  const partSizes: number[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const stored = byNumber.get(entry.part);
    if (!stored || stored.etag !== entry.etag) throwS3(s3Fail(400, 'InvalidPart', "A named part does not match."));
    if (entry.checksum !== undefined && stored.checksum_value !== entry.checksum) throwS3(s3Fail(400, 'InvalidPart', "A part checksum does not match."));
    if (i < entries.length - 1 && Number(stored.size) < PART_MIN) throwS3(s3Fail(400, 'EntityTooSmall', "Every part but the last must be at least 5 MiB."));
    totalSize += Number(stored.size);
    partSizes.push(Number(stored.size));
    partMd5s.push(stored.etag.replace(/"/g, ''));
  }
  if (totalSize > TOTAL_MAX) throwS3(s3Fail(413, 'EntityTooLarge', "The completed object is over the limit."));

  // Conditions checked against the current version at completion time.
  const ifMatch = req.headers['if-match'];
  const ifNoneMatch = req.headers['if-none-match'];
  const cur = await currentVersion(bucket!.name, key);
  if (ifMatch !== undefined) {
    if (!cur) throwS3(s3Fail(404, 'NoSuchKey', 'The key does not exist.'));
    if (cur.etag !== ifMatch) throwS3(s3Fail(412, 'PreconditionFailed', 'The precondition failed.'));
  }
  if (ifNoneMatch !== undefined && cur) throwS3(s3Fail(412, 'PreconditionFailed', 'The precondition failed.'));

  // Assemble the plaintext from the staged parts.
  const wk = workspaceKey(config.secretKey, ctx.ws.slug, upload.key_generation);
  const { unwrapDataKey, encryptBytes, decryptBytes } = await import('./crypto.js');
  const dk = unwrapDataKey(wk, upload.wrapped_key);
  if (!dk) throwS3(s3Fail(500, 'InternalError', 'The data key could not be unwrapped.'));
  const pieces: Buffer<ArrayBufferLike>[] = []
  for (const entry of entries) {
    const cipher = await getPart(uploadId, entry.part);
    if (!cipher) throwS3(s3Fail(400, 'InvalidPart', "A named part is missing."));
    const plain = decryptBytes(dk, cipher);
    if (!plain) throwS3(s3Fail(400, 'InvalidPart', "A named part is unreadable."));
    pieces.push(plain);
  }
  const bytes = Buffer.concat(pieces);
  const etag = '"' + md5Hex(Buffer.concat(partMd5s.map(m => Buffer.from(m, 'hex')))) + '-' + entries.length + '"';
  void encryptBytes;
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<CompleteMultipartUploadResult><Bucket>${xmlEscape(bucket!.name)}</Bucket><Key>${xmlEscape(key)}</Key><ETag>${xmlEscape(etag)}</ETag><Location>/s3/${xmlEscape(bucket!.name)}/${xmlEscape(key)}</Location></CompleteMultipartUploadResult>`;
  const created = await acknowledgeWrite({
    bucket: bucket!.name, key, bytes, contentType: req.headers['content-type'] ?? 'application/octet-stream',
    metadata: {}, tags: {}, partCount: entries.length, partSizes, partMd5s,
  });
  await tx(async client => {
    await client.query(`UPDATE multipart_uploads SET complete_result = $1 WHERE upload_id = $2`,
      [JSON.stringify({ status: 200, body, etag, version_id: created.version_id }), uploadId]);
    await client.query(`DELETE FROM quota_reservations WHERE upload_id = $1`, [uploadId]);
    await client.query(`DELETE FROM upload_parts WHERE upload_id = $1`, [uploadId]);
  });
  await deletePartPrefix(uploadId, entries.map(e => e.part));
  res.writeHead(200, { ETag: etag, 'x-amz-version-id': created.version_id });
  res.end(body);
}

async function abortMultipart(
  _req: Req, res: import('node:http').ServerResponse,
  bucketName: string, key: string, uploadId: string, ctx: S3Ctx,
): Promise<void> {
  const upload = await one<{ bucket_name: string; key: string }>(
    `SELECT bucket_name, key FROM multipart_uploads WHERE upload_id = $1`, [uploadId]
  );
  if (!upload || upload.bucket_name !== bucketName || upload.key !== key) throwS3(s3Fail(404, 'NoSuchUpload', 'The upload does not exist.'));
  const parts = await rows<{ part_number: number }>(`SELECT part_number FROM upload_parts WHERE upload_id = $1`, [uploadId]);
  await tx(async client => {
    await client.query(`DELETE FROM upload_parts WHERE upload_id = $1`, [uploadId]);
    await client.query(`DELETE FROM multipart_uploads WHERE upload_id = $1`, [uploadId]);
    await client.query(`DELETE FROM quota_reservations WHERE upload_id = $1`, [uploadId]);
  });
  await deletePartPrefix(uploadId, parts.map(p => p.part_number));
  void ctx;
  sendNoContent(res);
}

async function deleteObjects(
  _req: Req, res: import('node:http').ServerResponse, raw: Buffer,
  bucket: NonNullable<Awaited<ReturnType<typeof bucketByName>>>, ctx: S3Ctx,
): Promise<void> {
  if (raw.length > 2_097_152) throwS3(s3Fail(413, 'EntityTooLarge', 'The delete request is over the limit.'));
  const xml = raw.toString('utf8');
  const quiet = /<Quiet>\s*true\s*<\/Quiet>/.test(xml);
  const entries: Array<{ key: string; versionId?: string }> = [];
  const objRe = /<Object>([\s\S]*?)<\/Object>/g;
  let m: RegExpExecArray | null;
  while ((m = objRe.exec(xml)) !== null) {
    const seg = m[1];
    const key = /<Key>([\s\S]*?)<\/Key>/.exec(seg)?.[1];
    if (key === undefined) throwS3(s3Fail(400, 'MalformedXML', "Every object needs a key."));
    const versionId = /<VersionId>([\s\S]*?)<\/VersionId>/.exec(seg)?.[1];
    entries.push({ key, versionId });
  }
  if (entries.length < 1 || entries.length > 1000) throwS3(s3Fail(400, 'MalformedXML', "Choose 1 to 1,000 objects."));
  const seen = new Set<string>();
  let body = `<?xml version="1.0" encoding="UTF-8"?>\n<DeleteResult>`;
  for (const e of entries) {
    const pairKey = e.key + '\u0000' + (e.versionId ?? '');
    if (seen.has(pairKey)) continue;
    seen.add(pairKey);
    if (!isValidKey(e.key)) {
      body += `<Error><Key>${xmlEscape(e.key)}</Key><Code>InvalidArgument</Code><Message>The key can't be stored.</Message></Error>`;
      continue;
    }
    if (!prefixAllows(ctx.key.prefix, e.key)) {
      body += `<Error><Key>${xmlEscape(e.key)}</Key><Code>AccessDenied</Code><Message>This key is outside the key's prefix.</Message></Error>`;
      continue;
    }
    if (e.versionId === undefined) {
      const cur = await currentVersion(bucket.name, e.key);
      if (cur) await plainDelete(bucket.name, e.key, { ws: ctx.ws.slug });
      body += `<Deleted><Key>${xmlEscape(e.key)}</Key></Deleted>`;
      continue;
    }
    const v = await versionById(e.versionId);
    if (!v || v.state === 'removed' || v.bucket_name !== bucket.name || v.key !== e.key) {
      body += `<Deleted><Key>${xmlEscape(e.key)}</Key><VersionId>${xmlEscape(e.versionId)}</VersionId></Deleted>`;
      continue;
    }
    if (v.state === 'current') {
      body += `<Error><Key>${xmlEscape(e.key)}</Key><VersionId>${xmlEscape(e.versionId)}</VersionId><Code>InvalidArgument</Code><Message>The current version cannot be removed directly.</Message></Error>`;
      continue;
    }
    if (isLocked(v)) {
      body += `<Error><Key>${xmlEscape(e.key)}</Key><VersionId>${xmlEscape(e.versionId)}</VersionId><Code>AccessDenied</Code><Message>This version is under retention or legal hold.</Message></Error>`;
      continue;
    }
    await removeVersion(v, 'request', true);
    body += `<Deleted><Key>${xmlEscape(e.key)}</Key><VersionId>${xmlEscape(e.versionId)}</VersionId></Deleted>`;
  }
  body += `</DeleteResult>`;
  void quiet;
  xmlResponse(res, 200, body);
}
