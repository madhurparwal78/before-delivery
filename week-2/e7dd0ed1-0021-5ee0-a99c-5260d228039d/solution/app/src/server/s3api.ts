// The S3-compatible API under /s3 in path style, signed with SigV4 by Farshore access keys
// (brief: API, S3 API; Business rules, S3 payload modes and checksums; Signed S3 access; Multipart uploads).
import { createHash, timingSafeEqual } from "node:crypto";
import { one, pool, query, tx } from "./db.js";
import { downloadHeaders, openVersion, servedType, streamBody } from "./downloads.js";
import { ApiError, S3Error, s3KeyError, xmlEscape } from "./errors.js";
import { header, readBody, send, type Ctx } from "./http.js";
import {
  CHECKSUM_ALGORITHMS, declaredChecksum, decodeChunked, md5Etag, multipartEtag, verifyChecksum, verifyContentMd5, verifyPayloadSha256,
  type ChecksumAlgorithm, type SuppliedChecksum,
} from "./integrity.js";
import {
  DELETE_BODY_MAX, DELETE_ENTRIES_MAX, judgeContent, keyAllowed, metadataAllowed, MULTIPART_TOTAL_MAX, PAGE_MAX, PART_MAX, PART_MIN,
  PART_NUMBER_MAX, parseTags, SINGLE_UPLOAD_MAX,
} from "./limits.js";
import {
  CursorError, decodeCursor, encodeCursor, listEntries, positionAfter, validateDelimiter, validatePrefix, type Position,
} from "./listing.js";
import {
  bucketByName, commitVersion, currentVersion, newVersionId, parseCondition, permanentDelete, plainDelete, QuotaRefused,
  queueByteRemoval, releaseReservation, reserve, versionById, checkCondition, type Bucket, type Condition,
} from "./objects.js";
import { unseal } from "./secrets.js";
import { appendAudit, deniedRecord } from "./audit.js";
import { encryptPart, newDataKey, unwrapForWorkspace, wrapForWorkspace, type WrappedKey } from "./encryption.js";
import { keyExpired, previousSecretLive } from "./teamApi.js";
import { canonicalQuery, canonicalRequest, credentialScope, hmac, SCOPE_TERMINATOR, signingKey, stringToSign } from "./sigv4.js";
import { assembleParts, deleteObject, partObjectKey, putObject, regionObjectKey } from "./storage.js";
import { checkThresholds, meterRead } from "./usage.js";
import { userMetadata } from "./consoleApi.js";

interface AccessKey {
  key_id: string;
  workspace_id: string;
  workspace_slug: string;
  permission: "read" | "read-write";
  buckets: string[] | null;
  prefix: string | null;
  expires_at: Date | null;
  state: "active" | "disabled";
  sealed_secret: string;
  previous_sealed_secret: string | null;
  previous_secret_expires_at: Date | null;
  status: string;
  plan_id: string;
}

interface Signed {
  key: AccessKey;
  signingKey: Buffer;
  amzDate: string;
  scope: string;
  signature: string;
}

const SKEW_MS = 15 * 60 * 1000;
const SUPPORTED_STREAMING = new Set(["STREAMING-AWS4-HMAC-SHA256-PAYLOAD", "STREAMING-UNSIGNED-PAYLOAD-TRAILER"]);

function queryPairs(raw: string): Array<[string, string]> {
  if (!raw) return [];
  return raw.split("&").filter(Boolean).map((pair) => {
    const eq = pair.indexOf("=");
    const decode = (s: string): string => {
      try {
        return decodeURIComponent(s.replace(/\+/g, "%20"));
      } catch {
        return s;
      }
    };
    return eq < 0 ? [decode(pair), ""] : [decode(pair.slice(0, eq)), decode(pair.slice(eq + 1))];
  });
}

// SigV4 in the Authorization header: unknown, disabled, deleted or expired key, then skew, then
// signature. During a rotation overlap the previous secret also verifies, and the chunk signing key
// is derived from whichever secret verified the header signature.
async function authenticate(ctx: Ctx, pairs: Array<[string, string]>): Promise<Signed> {
  const authorization = header(ctx, "authorization") ?? "";
  const match = /^AWS4-HMAC-SHA256\s+Credential=([^,\s]+)\s*,\s*SignedHeaders=([^,\s]+)\s*,\s*Signature=([0-9a-f]{64})$/.exec(authorization.trim());
  if (!match) throw new S3Error("AccessDenied", "Requests must be signed with AWS Signature Version 4.");
  const [, credential = "", signedHeaders = "", signature = ""] = match;
  const [keyId = "", day = "", region = "", service = "", terminator = ""] = credential.split("/");
  const key = await one<AccessKey>(pool,
    `SELECT k.key_id, k.workspace_id, w.slug AS workspace_slug, k.permission, k.buckets, k.prefix, k.expires_at, k.state,
       k.sealed_secret, k.previous_sealed_secret, k.previous_secret_expires_at, w.status, w.plan_id
     FROM access_keys k JOIN workspaces w ON w.id = k.workspace_id WHERE k.key_id = $1 AND k.state = 'active'`, [keyId]);
  if (!key || keyExpired(key, ctx.now)) throw new S3Error("InvalidAccessKeyId");
  const date = header(ctx, "x-amz-date") ?? "";
  const parsed = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(date);
  const at = parsed ? Date.UTC(Number(parsed[1]), Number(parsed[2]) - 1, Number(parsed[3]), Number(parsed[4]), Number(parsed[5]), Number(parsed[6])) : NaN;
  if (Number.isNaN(at) || Math.abs(at - ctx.now.getTime()) > SKEW_MS) throw new S3Error("RequestTimeTooSkewed");
  const names = signedHeaders.split(";");
  const canonical = canonicalRequest({
    method: ctx.method,
    path: ctx.rawPath,
    query: canonicalQuery(pairs),
    headers: names.map((n) => [n, header(ctx, n) ?? ""]),
    payloadHash: header(ctx, "x-amz-content-sha256") ?? "",
  });
  const scope = credentialScope(day, region, service);
  const toSign = stringToSign(date, scope, canonical);
  const given = Buffer.from(signature, "hex");
  const verifies = (secret: string): Buffer | null => {
    const kSigning = signingKey(secret, day, region, service);
    return timingSafeEqual(hmac(kSigning, toSign), given) ? kSigning : null;
  };
  const wellFormed = service === "s3" && terminator === SCOPE_TERMINATOR && names.includes("host");
  let kSigning = wellFormed ? verifies(unseal(key.sealed_secret)) : null;
  const previous = wellFormed && previousSecretLive(key, ctx.now) ? key.previous_sealed_secret : null;
  const viaPrevious = kSigning === null && previous !== null;
  if (viaPrevious) kSigning = verifies(unseal(previous));
  if (!kSigning) throw new S3Error("SignatureDoesNotMatch");
  await pool.query(
    `UPDATE access_keys SET last_used_at = date_trunc('second', now())${viaPrevious ? ", previous_secret_last_used_at = date_trunc('second', now())" : ""}
     WHERE key_id = $1`, [key.key_id]);
  return { key, signingKey: kSigning, amzDate: date, scope, signature };
}

// A refusal for the key's permission, bucket scope or prefix, recorded in the audit trail.
function accessDenied(key: AccessKey): S3Error {
  return new S3Error("AccessDenied", undefined, undefined, { workspaceSlug: key.workspace_slug, actor: `key:${key.key_id}` });
}

// The prefix scope, decided once: a key with a prefix names only object keys under it.
const withinPrefix = (key: AccessKey, objectKey: string): boolean => key.prefix === null || objectKey.startsWith(key.prefix);

type Operation =
  | "PutObject" | "GetObject" | "HeadObject" | "DeleteObject" | "DeleteObjects" | "ListObjectsV2"
  | "CreateMultipartUpload" | "UploadPart" | "CompleteMultipartUpload" | "AbortMultipartUpload";

const OBJECT_PARAMS = new Set(["versionId", "x-id"]);
const LIST_PARAMS = new Set(["list-type", "prefix", "delimiter", "max-keys", "continuation-token", "start-after", "encoding-type",
  "fetch-owner", "x-id"]);

function operationOf(method: string, hasKey: boolean, params: Map<string, string>): Operation | null {
  const names = [...params.keys()];
  const only = (allowed: Set<string>): boolean => names.every((n) => allowed.has(n));
  if (!hasKey) {
    if (method === "GET" && params.get("list-type") === "2" && only(LIST_PARAMS)) return "ListObjectsV2";
    if (method === "POST" && params.has("delete") && only(new Set(["delete", "x-id"]))) return "DeleteObjects";
    return null;
  }
  if (method === "POST" && params.has("uploads") && only(new Set(["uploads", "x-id"]))) return "CreateMultipartUpload";
  if (method === "PUT" && params.has("uploadId") && params.has("partNumber") && only(new Set(["uploadId", "partNumber", "x-id"]))) return "UploadPart";
  if (method === "POST" && params.has("uploadId") && only(new Set(["uploadId", "x-id"]))) return "CompleteMultipartUpload";
  if (method === "DELETE" && params.has("uploadId") && only(new Set(["uploadId", "x-id"]))) return "AbortMultipartUpload";
  if (!only(OBJECT_PARAMS)) return null;
  if (method === "PUT" && !params.has("versionId")) return "PutObject";
  if (method === "GET") return "GetObject";
  if (method === "HEAD") return "HeadObject";
  if (method === "DELETE") return "DeleteObject";
  return null;
}

const WRITES = new Set<Operation>(["PutObject", "DeleteObject", "DeleteObjects", "CreateMultipartUpload", "UploadPart",
  "CompleteMultipartUpload", "AbortMultipartUpload"]);

function xml(ctx: Ctx, status: number, body: string, headers: Record<string, string> = {}): void {
  send(ctx, status, { "Content-Type": "application/xml", ...headers }, `<?xml version="1.0" encoding="UTF-8"?>\n${body}`);
}

const S3_NS = 'xmlns="http://s3.amazonaws.com/doc/2006-03-01/"';

// Translates a JSON-domain refusal raised by the shared object rules into its S3 code.
function asS3(error: unknown): unknown {
  if (!(error instanceof ApiError)) return error;
  switch (error.code) {
    case "precondition_failed": return new S3Error("PreconditionFailed");
    case "not_found": return new S3Error("NoSuchKey");
    case "invalid_transition": return new S3Error("InvalidArgument", "The current version can't be deleted by version ID.");
    case "object_locked": return new S3Error("AccessDenied", "This version is under retention or legal hold.");
    case "storage_unavailable": case "service_unavailable": return new S3Error("ServiceUnavailable");
    default: return error;
  }
}

export async function handleS3(ctx: Ctx): Promise<void> {
  const rest = ctx.rawPath.slice("/s3".length).replace(/^\//, "");
  const slash = rest.indexOf("/");
  const decode = (s: string): string => {
    try {
      return decodeURIComponent(s);
    } catch {
      throw new S3Error("InvalidArgument", "The path is not valid URL encoding.");
    }
  };
  const bucketName = decode(slash < 0 ? rest : rest.slice(0, slash));
  const key = slash < 0 ? null : decode(rest.slice(slash + 1));
  const pairs = queryPairs(ctx.rawQuery);
  const signed = await authenticate(ctx, pairs);
  const params = new Map(pairs);
  const payloadMode = header(ctx, "x-amz-content-sha256") ?? "";
  const operation = bucketName ? operationOf(ctx.method, key !== null && key !== "", params) : null;
  if (!operation || (payloadMode.startsWith("STREAMING-") && !SUPPORTED_STREAMING.has(payloadMode))) {
    throw new S3Error("NotImplemented");
  }
  const bucket = await bucketByName(pool, bucketName);
  if (!bucket) throw new S3Error("NoSuchBucket");
  const { key: access } = signed;
  if (bucket.workspace_id !== access.workspace_id) throw new S3Error("AccessDenied");
  if (access.buckets !== null && !access.buckets.includes(bucket.name)) throw accessDenied(access);
  if (WRITES.has(operation) && access.permission !== "read-write") throw accessDenied(access);
  if (operation === "ListObjectsV2" ? !withinPrefix(access, params.get("prefix") ?? "") || (access.prefix !== null && !params.has("prefix"))
    : operation !== "DeleteObjects" && !withinPrefix(access, key ?? "")) throw accessDenied(access);
  if (access.status === "suspended") throw new S3Error("AccountSuspended");
  if (payloadMode.startsWith("STREAMING-") && operation !== "PutObject" && operation !== "UploadPart") {
    throw new S3Error("InvalidArgument", "Chunked payloads are accepted only by PutObject and UploadPart.");
  }
  try {
    switch (operation) {
      case "ListObjectsV2": return await listObjectsV2(ctx, bucket, params);
      case "DeleteObjects": return await deleteObjects(ctx, bucket, access);
      case "PutObject": return await putObjectOp(ctx, bucket, key ?? "", signed);
      case "GetObject": case "HeadObject": return await getObjectOp(ctx, bucket, key ?? "", params.get("versionId"));
      case "DeleteObject": return await deleteObjectOp(ctx, bucket, key ?? "", params.get("versionId"));
      case "CreateMultipartUpload": return await createUpload(ctx, bucket, key ?? "");
      case "UploadPart": return await uploadPart(ctx, bucket, key ?? "", params, signed);
      case "CompleteMultipartUpload": return await completeUpload(ctx, bucket, key ?? "", params.get("uploadId") ?? "");
      case "AbortMultipartUpload": return await abortUpload(ctx, bucket, key ?? "", params.get("uploadId") ?? "");
    }
  } catch (error) {
    throw asS3(error);
  }
}

// ---- Bodies ----

interface Payload {
  data: Buffer;
  checksum: SuppliedChecksum | null;
}

// Header-decidable payload checks, before quota and before the body is read.
function payloadPlan(ctx: Ctx, limit: number): { size: number; chunked: boolean; header: SuppliedChecksum | null; trailer: ChecksumAlgorithm | null } {
  const mode = header(ctx, "x-amz-content-sha256") ?? "";
  const chunked = mode.startsWith("STREAMING-");
  let size: number;
  if (chunked) {
    const decoded = header(ctx, "x-amz-decoded-content-length");
    if (decoded === undefined || !/^\d{1,15}$/.test(decoded)) {
      if (Number(header(ctx, "content-length") ?? 0) > limit + 1_048_576) throw new S3Error("EntityTooLarge");
      throw new S3Error("InvalidArgument", "Chunked uploads need x-amz-decoded-content-length.");
    }
    size = Number(decoded);
  } else {
    size = Number(header(ctx, "content-length") ?? "0");
  }
  if (size > limit) throw new S3Error("EntityTooLarge");
  const declared = declaredChecksum(ctx.req.headers as Record<string, string | undefined>);
  if (declared.trailer && mode !== "STREAMING-UNSIGNED-PAYLOAD-TRAILER") {
    throw new S3Error("InvalidArgument", "Trailing checksums need STREAMING-UNSIGNED-PAYLOAD-TRAILER.");
  }
  if (mode === "STREAMING-UNSIGNED-PAYLOAD-TRAILER" && !declared.trailer) {
    throw new S3Error("InvalidArgument", "x-amz-trailer must name one checksum header.");
  }
  const md5 = header(ctx, "Content-MD5");
  if (md5 !== undefined && Buffer.from(md5, "base64").length !== 16) throw new S3Error("InvalidArgument", "Content-MD5 is not valid.");
  if (!chunked && mode !== "UNSIGNED-PAYLOAD" && !/^[0-9a-f]{64}$/.test(mode)) {
    throw new S3Error("InvalidArgument", "x-amz-content-sha256 is not a supported payload hash.");
  }
  return { size, chunked, header: declared.header, trailer: declared.trailer };
}

async function readPayload(ctx: Ctx, plan: ReturnType<typeof payloadPlan>, signed: Signed): Promise<Payload> {
  const mode = header(ctx, "x-amz-content-sha256") ?? "";
  const raw = await readBody(ctx, plan.chunked ? plan.size + 1_048_576 + Math.ceil(plan.size / 8192) * 100 : plan.size);
  if (raw === null) throw new S3Error(plan.chunked ? "IncompleteBody" : "EntityTooLarge");
  let data = raw;
  let trailer: SuppliedChecksum | null = null;
  if (plan.chunked) {
    const decoded = decodeChunked(raw, plan.size,
      mode === "STREAMING-AWS4-HMAC-SHA256-PAYLOAD"
        ? { key: signed.signingKey, amzDate: signed.amzDate, scope: signed.scope, seedSignature: signed.signature } : null,
      plan.trailer);
    data = decoded.data;
    trailer = decoded.trailer;
  } else {
    verifyPayloadSha256(mode, raw);
    if (raw.length !== plan.size) throw new S3Error("IncompleteBody");
  }
  verifyContentMd5(header(ctx, "Content-MD5"), data);
  const supplied = plan.header ?? trailer;
  if (supplied) verifyChecksum(supplied, data);
  return { data, checksum: supplied };
}

function headerValidation(ctx: Ctx, key: string): { metadata: Record<string, string>; tags: Record<string, string> } {
  if (!keyAllowed(key)) throw new S3Error("InvalidArgument", "This key can't be stored.");
  const metadata = userMetadata(ctx);
  if (!metadataAllowed(metadata)) throw new S3Error("MetadataTooLarge");
  const tags = parseTags(header(ctx, "x-amz-tagging"));
  if (!tags) throw new S3Error("InvalidTag");
  return { metadata, tags };
}

async function reserveOrRefuse(bucket: Bucket, planId: string, bytes: number, part?: { uploadId: string; partNumber: number }): Promise<number> {
  try {
    return await reserve(bucket.workspace_id, planId, bytes, part);
  } catch (error) {
    if (error instanceof QuotaRefused) throw new S3Error("QuotaExceeded");
    throw error;
  }
}

async function requireOriginOnline(bucket: Bucket): Promise<void> {
  const region = await one<{ state: string }>(pool, "SELECT state FROM regions WHERE id = $1", [bucket.placement[0] ?? ""]);
  if (region?.state === "offline") throw new S3Error("SlowDown", undefined, 30);
}

// ---- Objects ----

async function putObjectOp(ctx: Ctx, bucket: Bucket, key: string, signed: Signed): Promise<void> {
  const condition = parseCondition(header(ctx, "if-match"), header(ctx, "if-none-match"));
  checkCondition(await currentVersion(pool, bucket.id, key), condition);
  const plan = payloadPlan(ctx, SINGLE_UPLOAD_MAX);
  const { metadata, tags } = headerValidation(ctx, key);
  const reservation = await reserveOrRefuse(bucket, signed.key.plan_id, plan.size * bucket.placement.length);
  const versionId = newVersionId();
  const target = regionObjectKey(bucket.placement[0] ?? "", bucket.name, versionId);
  let stored = false;
  try {
    await requireOriginOnline(bucket);
    const payload = await readPayload(ctx, plan, signed);
    const verdict = judgeContent(payload.data, header(ctx, "content-type"));
    if ("refused" in verdict) throw new S3Error("InvalidArgument", "SVG files with scripts are not accepted.");
    const dataKey = newDataKey();
    await putObject(target, encryptPart(dataKey, payload.data));
    stored = true;
    const version = await tx((client) => commitVersion(client, {
      bucket, key, versionId, size: payload.data.length, etag: md5Etag(payload.data), contentType: verdict.contentType, metadata, tags,
      checksum: payload.checksum, partSizes: null, dataKey, condition, reservationIds: [reservation], seeded: false,
    }));
    ctx.now = new Date();
    const headers: Record<string, string> = { ETag: version.etag, "x-amz-version-id": version.version_id };
    if (payload.checksum) headers[`x-amz-checksum-${payload.checksum.algorithm}`] = payload.checksum.value;
    send(ctx, 200, headers);
    void checkThresholds(bucket.workspace_id).catch(() => undefined);
  } catch (error) {
    await releaseReservation(reservation).catch(() => undefined);
    if (stored) await deleteObject(target).catch(() => undefined);
    throw error;
  }
}

async function getObjectOp(ctx: Ctx, bucket: Bucket, key: string, versionId: string | undefined): Promise<void> {
  const version = versionId ? await versionById(pool, bucket.id, key, versionId) : await currentVersion(pool, bucket.id, key);
  if (!version) throw new S3Error("NoSuchKey");
  const headers: Record<string, string | number> = {
    ETag: version.etag, "x-amz-version-id": version.version_id, "Last-Modified": version.last_modified.toUTCString(),
    "Content-Length": version.size, "Content-Type": servedType(version, true),
    "x-amz-tagging-count": Object.keys(version.tags).length,
  };
  for (const [name, value] of Object.entries(version.metadata)) {
    headers[`x-amz-meta-${name}`] = Buffer.from(value, "utf8").toString("latin1");
  }
  if (header(ctx, "x-amz-checksum-mode")?.toUpperCase() === "ENABLED" && version.checksum_algorithm && version.checksum_value &&
      !version.part_sizes) {
    headers[`x-amz-checksum-${version.checksum_algorithm}`] = version.checksum_value;
  }
  if (ctx.method === "HEAD") {
    await streamBody(ctx, 200, headers, null);
    return;
  }
  const body = await openVersion(bucket, version);
  await meterRead(bucket, version.size);
  await streamBody(ctx, 200, { ...headers, ...downloadHeaders(version.key) }, body);
}

async function deleteObjectOp(ctx: Ctx, bucket: Bucket, key: string, versionId: string | undefined): Promise<void> {
  if (!keyAllowed(key)) throw new S3Error("InvalidArgument", "This key can't be stored.");
  if (versionId === undefined) await tx((client) => plainDelete(client, bucket, key));
  else await tx((client) => permanentDelete(client, bucket, key, versionId));
  send(ctx, 204, {});
}

// ---- DeleteObjects ----

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function xmlText(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) =>
    e.startsWith("#x") ? String.fromCodePoint(parseInt(e.slice(2), 16))
      : e.startsWith("#") ? String.fromCodePoint(Number(e.slice(1))) : ENTITY[e] ?? "");
}

function parseDeleteBody(body: string): { quiet: boolean; entries: Array<{ key: string; versionId: string | null }> } {
  const doc = /^\s*(<\?xml[^>]*\?>\s*)?<Delete(\s[^>]*)?>([\s\S]*)<\/Delete>\s*$/.exec(body);
  if (!doc) throw new S3Error("MalformedXML");
  let inner = doc[3] ?? "";
  let quiet = false;
  inner = inner.replace(/<Quiet>\s*(true|false)\s*<\/Quiet>/, (_, q: string) => {
    quiet = q === "true";
    return "";
  });
  const entries: Array<{ key: string; versionId: string | null }> = [];
  const pattern = /<Object>\s*<Key>([^<]*)<\/Key>\s*(?:<VersionId>([^<]*)<\/VersionId>\s*)?<\/Object>/g;
  let consumed = "";
  for (const match of inner.matchAll(pattern)) {
    entries.push({ key: xmlText(match[1] ?? ""), versionId: match[2] === undefined ? null : xmlText(match[2]) });
    consumed += match[0];
  }
  if (inner.replace(pattern, "").trim() !== "" || entries.length < 1 || entries.length > DELETE_ENTRIES_MAX || !consumed) {
    throw new S3Error("MalformedXML");
  }
  return { quiet, entries };
}

async function deleteObjects(ctx: Ctx, bucket: Bucket, access: AccessKey): Promise<void> {
  const raw = await readBody(ctx, DELETE_BODY_MAX);
  if (raw === null) throw new S3Error("EntityTooLarge");
  verifyContentMd5(header(ctx, "Content-MD5"), raw);
  const declared = declaredChecksum(ctx.req.headers as Record<string, string | undefined>);
  if (declared.header) verifyChecksum(declared.header, raw);
  const { quiet, entries } = parseDeleteBody(raw.toString("utf8"));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of entries) {
    const id = `${entry.key}\u0000${entry.versionId ?? ""}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const versionXml = entry.versionId !== null ? `<VersionId>${xmlEscape(entry.versionId)}</VersionId>` : "";
    if (!keyAllowed(entry.key)) {
      out.push(s3KeyError(new S3Error("InvalidArgument", "This key can't be stored."), entry.key, entry.versionId));
      continue;
    }
    if (!withinPrefix(access, entry.key)) {
      await appendAudit(pool, access.workspace_slug, deniedRecord(`key:${access.key_id}`, ctx.method, ctx.rawPath, entry.key, bucket.name), ctx.now);
      out.push(s3KeyError(new S3Error("AccessDenied"), entry.key, entry.versionId));
      continue;
    }
    try {
      if (entry.versionId === null) await tx((client) => plainDelete(client, bucket, entry.key));
      else {
        const versionId = entry.versionId;
        await tx((client) => permanentDelete(client, bucket, entry.key, versionId));
      }
      if (!quiet) out.push(`<Deleted><Key>${xmlEscape(entry.key)}</Key>${versionXml}</Deleted>`);
    } catch (error) {
      const translated = asS3(error);
      if (!(translated instanceof S3Error) || translated.status >= 500) throw translated;
      out.push(s3KeyError(translated, entry.key, entry.versionId));
    }
  }
  xml(ctx, 200, `<DeleteResult ${S3_NS}>${out.join("")}</DeleteResult>`);
}

// ---- ListObjectsV2 ----

// encoding-type=url: A–Z a–z 0–9 - _ . ~ / stay, space becomes +, every other byte %XX.
function urlEncodeName(value: string): string {
  let out = "";
  for (const byte of Buffer.from(value, "utf8")) {
    const c = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-_.~/]/.test(c)) out += c;
    else if (c === " ") out += "+";
    else out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

async function listObjectsV2(ctx: Ctx, bucket: Bucket, params: Map<string, string>): Promise<void> {
  const prefix = params.get("prefix") ?? "";
  const delimiter = params.get("delimiter") ?? "";
  const encoding = params.get("encoding-type");
  const maxText = params.get("max-keys");
  if (maxText !== undefined && !/^\d+$/.test(maxText)) throw new S3Error("InvalidArgument", "max-keys must be a non-negative integer.");
  if (encoding !== undefined && encoding !== "url") throw new S3Error("InvalidArgument", "encoding-type must be url.");
  if (!validatePrefix(prefix) || !validateDelimiter(delimiter)) throw new S3Error("InvalidArgument", "The prefix or delimiter is too long.");
  const maxKeys = Math.min(maxText === undefined ? PAGE_MAX : Number(maxText), PAGE_MAX);
  const scope = { bucketId: bucket.id, prefix, delimiter, filter: "" };
  const token = params.get("continuation-token");
  const startAfter = params.get("start-after");
  let from: Position | null = null;
  if (token !== undefined) {
    try {
      from = decodeCursor(token, scope);
    } catch (error) {
      if (error instanceof CursorError || error instanceof SyntaxError) throw new S3Error("InvalidArgument", "The continuation token is not valid.");
      throw error;
    }
  } else if (startAfter) {
    from = positionAfter(startAfter, prefix, delimiter);
  }
  const result = maxKeys === 0
    ? { entries: [], next: null, truncated: false }
    : await listEntries(pool, { bucketId: bucket.id, prefix, delimiter, filter: { source: "", node: null }, from, limit: maxKeys });
  const name = (value: string): string => xmlEscape(encoding === "url" ? urlEncodeName(value) : value);
  const parts = [
    `<Name>${xmlEscape(bucket.name)}</Name>`, `<Prefix>${name(prefix)}</Prefix>`,
    delimiter ? `<Delimiter>${name(delimiter)}</Delimiter>` : "",
    `<MaxKeys>${maxKeys}</MaxKeys>`, `<KeyCount>${result.entries.length}</KeyCount>`,
    `<IsTruncated>${result.next ? "true" : "false"}</IsTruncated>`,
    token !== undefined ? `<ContinuationToken>${xmlEscape(token)}</ContinuationToken>` : "",
    result.next ? `<NextContinuationToken>${encodeCursor(scope, result.next)}</NextContinuationToken>` : "",
    startAfter !== undefined ? `<StartAfter>${name(startAfter)}</StartAfter>` : "",
    encoding === "url" ? "<EncodingType>url</EncodingType>" : "",
    ...result.entries.map((e) => e.kind === "object"
      ? `<Contents><Key>${name(e.version.key)}</Key><LastModified>${e.version.last_modified.toISOString()}</LastModified>` +
        `<ETag>${xmlEscape(e.version.etag)}</ETag><Size>${e.version.size}</Size><StorageClass>STANDARD</StorageClass></Contents>`
      : `<CommonPrefixes><Prefix>${name(e.prefix)}</Prefix></CommonPrefixes>`),
  ];
  xml(ctx, 200, `<ListBucketResult ${S3_NS}>${parts.join("")}</ListBucketResult>`);
}

// ---- Multipart uploads ----

interface Upload {
  upload_id: string;
  bucket_id: number;
  key: string;
  state: "open" | "completed" | "aborted";
  checksum_algorithm: ChecksumAlgorithm | null;
  content_type: string;
  metadata: Record<string, string>;
  tags: Record<string, string>;
  completed_parts: string | null;
  completed_etag: string | null;
  completed_version_id: string | null;
  wrapped_key: Buffer | null;
  key_generation: number | null;
}

// An open upload's own data key, under which its parts are staged and its version is stored.
async function uploadDataKey(bucket: Bucket, upload: Upload): Promise<Buffer> {
  const fresh = await one<WrappedKey>(pool, "SELECT wrapped_key, key_generation FROM uploads WHERE upload_id = $1 AND state = 'open'",
    [upload.upload_id]);
  if (!fresh?.wrapped_key) throw new S3Error("NoSuchUpload");
  return unwrapForWorkspace(pool, bucket.workspace_id, fresh);
}

interface Part {
  part_number: number;
  size: number;
  etag: string;
  checksum_algorithm: string | null;
  checksum_value: string | null;
}

async function uploadFor(bucket: Bucket, key: string, uploadId: string): Promise<Upload> {
  const upload = await one<Upload>(pool, "SELECT * FROM uploads WHERE upload_id = $1 AND bucket_id = $2 AND key = $3",
    [uploadId, bucket.id, key]);
  if (!upload || upload.state === "aborted") throw new S3Error("NoSuchUpload");
  return upload;
}

async function createUpload(ctx: Ctx, bucket: Bucket, key: string): Promise<void> {
  const { metadata, tags } = headerValidation(ctx, key);
  const declared = header(ctx, "x-amz-checksum-algorithm")?.toLowerCase();
  const algorithm = declared === undefined ? null : CHECKSUM_ALGORITHMS.find((a) => a === declared) ?? null;
  if (declared !== undefined && !algorithm) throw new S3Error("InvalidArgument", "x-amz-checksum-algorithm is not supported.");
  const uploadId = createHash("sha256").update(`${newVersionId()}${Date.now()}`).digest("base64url");
  await tx(async (client) => {
    const wrapped = await wrapForWorkspace(client, bucket.workspace_id, newDataKey());
    await client.query(
      `INSERT INTO uploads (upload_id, bucket_id, workspace_id, key, initiated_at, state, checksum_algorithm, content_type, metadata, tags,
         wrapped_key, key_generation)
       VALUES ($1, $2, $3, $4, now(), 'open', $5, $6, $7, $8, $9, $10)`,
      [uploadId, bucket.id, bucket.workspace_id, key, algorithm,
        header(ctx, "content-type")?.split(";")[0]?.trim() || "application/octet-stream", JSON.stringify(metadata), JSON.stringify(tags),
        wrapped.wrapped_key, wrapped.key_generation]);
  });
  const echo = algorithm ? `<ChecksumAlgorithm>${algorithm.toUpperCase()}</ChecksumAlgorithm>` : "";
  xml(ctx, 200, `<InitiateMultipartUploadResult ${S3_NS}><Bucket>${xmlEscape(bucket.name)}</Bucket><Key>${xmlEscape(key)}</Key>` +
    `<UploadId>${uploadId}</UploadId>${echo}</InitiateMultipartUploadResult>`,
  algorithm ? { "x-amz-checksum-algorithm": algorithm.toUpperCase() } : {});
}

async function uploadPart(ctx: Ctx, bucket: Bucket, key: string, params: Map<string, string>, signed: Signed): Promise<void> {
  const upload = await uploadFor(bucket, key, params.get("uploadId") ?? "");
  if (upload.state !== "open") throw new S3Error("NoSuchUpload");
  const plan = payloadPlan(ctx, PART_MAX);
  const numberText = params.get("partNumber") ?? "";
  const partNumber = /^\d{1,4}$/.test(numberText) ? Number(numberText) : 0;
  if (partNumber < 1 || partNumber > PART_NUMBER_MAX) throw new S3Error("InvalidArgument", "Part numbers run from 1 to 1,000.");
  const algorithm = plan.header?.algorithm ?? plan.trailer;
  if (algorithm && upload.checksum_algorithm && algorithm !== upload.checksum_algorithm) {
    throw new S3Error("InvalidArgument", "The part checksum algorithm differs from the one the upload declared.");
  }
  const reservation = await reserveOrRefuse(bucket, signed.key.plan_id, plan.size * bucket.placement.length,
    { uploadId: upload.upload_id, partNumber });
  try {
    await requireOriginOnline(bucket);
    const payload = await readPayload(ctx, plan, signed);
    const etag = md5Etag(payload.data);
    await putObject(partObjectKey(upload.upload_id, partNumber), encryptPart(await uploadDataKey(bucket, upload), payload.data));
    const stillOpen = await one(pool,
      `WITH open AS (SELECT 1 FROM uploads WHERE upload_id = $1 AND state = 'open')
       INSERT INTO upload_parts (upload_id, part_number, size, etag, checksum_algorithm, checksum_value)
       SELECT $1, $2, $3, $4, $5, $6 FROM open
       ON CONFLICT (upload_id, part_number) DO UPDATE SET size = EXCLUDED.size, etag = EXCLUDED.etag,
         checksum_algorithm = EXCLUDED.checksum_algorithm, checksum_value = EXCLUDED.checksum_value RETURNING 1`,
      [upload.upload_id, partNumber, payload.data.length, etag, payload.checksum?.algorithm ?? null, payload.checksum?.value ?? null]);
    if (!stillOpen) throw new S3Error("NoSuchUpload");
    ctx.now = new Date();
    const headers: Record<string, string> = { ETag: etag };
    if (payload.checksum) headers[`x-amz-checksum-${payload.checksum.algorithm}`] = payload.checksum.value;
    send(ctx, 200, headers);
  } catch (error) {
    await releaseReservation(reservation).catch(() => undefined);
    throw error;
  }
}

const CHECKSUM_TAGS: Record<string, ChecksumAlgorithm> = {
  ChecksumCRC32: "crc32", ChecksumCRC32C: "crc32c", ChecksumSHA1: "sha1", ChecksumSHA256: "sha256",
};

interface ListedPart {
  number: number;
  etag: string;
  checksums: Array<[ChecksumAlgorithm, string]>;
}

function parseCompleteBody(body: string): ListedPart[] {
  const doc = /^\s*(<\?xml[^>]*\?>\s*)?<CompleteMultipartUpload(\s[^>]*)?>([\s\S]*)<\/CompleteMultipartUpload>\s*$/.exec(body);
  if (!doc) throw new S3Error("MalformedXML");
  const inner = doc[3] ?? "";
  const parts: ListedPart[] = [];
  const pattern = /<Part>([\s\S]*?)<\/Part>/g;
  for (const match of inner.matchAll(pattern)) {
    const fields = new Map([...(match[1] ?? "").matchAll(/<(\w+)>([^<]*)<\/\1>/g)].map((f) => [f[1] ?? "", xmlText(f[2] ?? "").trim()]));
    const number = Number(fields.get("PartNumber"));
    const etag = fields.get("ETag");
    if (!Number.isInteger(number) || !etag) throw new S3Error("MalformedXML");
    const checksums = Object.entries(CHECKSUM_TAGS).flatMap(([tag, alg]) => {
      const value = fields.get(tag);
      return value === undefined ? [] : [[alg, value] as [ChecksumAlgorithm, string]];
    });
    parts.push({ number, etag: etag.startsWith('"') ? etag : `"${etag}"`, checksums });
  }
  if (!parts.length || inner.replace(pattern, "").trim() !== "") throw new S3Error("MalformedXML");
  return parts;
}

const partListSignature = (parts: ListedPart[]): string => parts.map((p) => `${p.number}:${p.etag}`).join(",");

function completeResult(ctx: Ctx, bucket: Bucket, key: string, etag: string, versionId: string): void {
  xml(ctx, 200, `<CompleteMultipartUploadResult ${S3_NS}><Location>${xmlEscape(`${ctx.origin}/s3/${bucket.name}/${key}`)}</Location>` +
    `<Bucket>${xmlEscape(bucket.name)}</Bucket><Key>${xmlEscape(key)}</Key><ETag>${xmlEscape(etag)}</ETag></CompleteMultipartUploadResult>`,
  { "x-amz-version-id": versionId });
}

async function completeUpload(ctx: Ctx, bucket: Bucket, key: string, uploadId: string): Promise<void> {
  const upload = await uploadFor(bucket, key, uploadId);
  const raw = await readBody(ctx, DELETE_BODY_MAX);
  if (raw === null) throw new S3Error("EntityTooLarge");
  const listed = parseCompleteBody(raw.toString("utf8"));
  // A completed upload answers its original result before any condition is checked.
  if (upload.state === "completed") {
    if (upload.completed_parts !== partListSignature(listed) || !upload.completed_etag || !upload.completed_version_id) {
      throw new S3Error("InvalidPart");
    }
    completeResult(ctx, bucket, key, upload.completed_etag, upload.completed_version_id);
    return;
  }
  const condition: Condition = parseCondition(header(ctx, "if-match"), header(ctx, "if-none-match"));
  checkCondition(await currentVersion(pool, bucket.id, key), condition);
  const staged = new Map((await query<Part>(pool, "SELECT * FROM upload_parts WHERE upload_id = $1", [upload.upload_id]))
    .map((p) => [p.part_number, p]));
  const total = listed.reduce((sum, p) => sum + (staged.get(p.number)?.size ?? 0), 0);
  if (total > MULTIPART_TOTAL_MAX) throw new S3Error("EntityTooLarge");
  for (const [i, p] of listed.entries()) {
    if (i > 0 && p.number <= (listed[i - 1]?.number ?? 0)) throw new S3Error("InvalidPartOrder");
  }
  for (const p of listed) {
    const part = staged.get(p.number);
    if (!part || part.etag !== p.etag) throw new S3Error("InvalidPart");
    for (const [alg, value] of p.checksums) {
      if (part.checksum_algorithm !== alg || part.checksum_value !== value) throw new S3Error("InvalidPart");
    }
  }
  for (const [i, p] of listed.entries()) {
    if (i < listed.length - 1 && (staged.get(p.number)?.size ?? 0) < PART_MIN) throw new S3Error("EntityTooSmall");
  }
  await requireOriginOnline(bucket);
  const dataKey = await uploadDataKey(bucket, upload);
  const versionId = newVersionId();
  const target = regionObjectKey(bucket.placement[0] ?? "", bucket.name, versionId);
  await assembleParts(target, listed.map((p) => partObjectKey(upload.upload_id, p.number)));
  const etag = multipartEtag(listed.map((p) => p.etag));
  try {
    await tx(async (client) => {
      const locked = await one<{ state: string }>(client, "SELECT state FROM uploads WHERE upload_id = $1 FOR UPDATE", [upload.upload_id]);
      if (locked?.state !== "open") throw new S3Error("NoSuchUpload");
      const named = await query<{ id: number }>(client,
        "SELECT id FROM reservations WHERE upload_id = $1 AND part_number = ANY($2)", [upload.upload_id, listed.map((p) => p.number)]);
      await commitVersion(client, {
        bucket, key, versionId, size: total, etag, contentType: upload.content_type, metadata: upload.metadata, tags: upload.tags,
        checksum: null, partSizes: listed.map((p) => staged.get(p.number)?.size ?? 0), dataKey, condition,
        reservationIds: named.map((r) => r.id), seeded: false,
      });
      await client.query("DELETE FROM reservations WHERE upload_id = $1", [upload.upload_id]);
      await client.query(
        `UPDATE uploads SET state = 'completed', completed_parts = $2, completed_etag = $3, completed_version_id = $4,
           completed_at = now(), wrapped_key = NULL, key_generation = NULL WHERE upload_id = $1`, [upload.upload_id, partListSignature(listed), etag, versionId]);
      await queueByteRemoval(client, [...staged.keys()].map((n) => partObjectKey(upload.upload_id, n)));
    });
  } catch (error) {
    await deleteObject(target).catch(() => undefined);
    throw error;
  }
  ctx.now = new Date();
  completeResult(ctx, bucket, key, etag, versionId);
  void checkThresholds(bucket.workspace_id).catch(() => undefined);
}

// Aborting releases the reservations and removes the staged parts (also used by lifecycle).
export async function abortOpenUpload(uploadId: string): Promise<boolean> {
  return tx(async (client) => {
    const upload = await one<{ state: string }>(client, "SELECT state FROM uploads WHERE upload_id = $1 FOR UPDATE", [uploadId]);
    if (upload?.state !== "open") return false;
    await client.query("UPDATE uploads SET state = 'aborted', wrapped_key = NULL, key_generation = NULL WHERE upload_id = $1", [uploadId]);
    await client.query("DELETE FROM reservations WHERE upload_id = $1", [uploadId]);
    const parts = await query<{ part_number: number }>(client, "SELECT part_number FROM upload_parts WHERE upload_id = $1", [uploadId]);
    await queueByteRemoval(client, parts.map((p) => partObjectKey(uploadId, p.part_number)));
    return true;
  });
}

async function abortUpload(ctx: Ctx, bucket: Bucket, key: string, uploadId: string): Promise<void> {
  const upload = await uploadFor(bucket, key, uploadId);
  if (upload.state !== "open" || !(await abortOpenUpload(upload.upload_id))) throw new S3Error("NoSuchUpload");
  send(ctx, 204, {});
}

