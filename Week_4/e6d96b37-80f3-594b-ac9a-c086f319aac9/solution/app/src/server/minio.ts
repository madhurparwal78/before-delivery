// MinIO over the S3 API (Signature V4), private bucket, every call bounded by the provider timeout.
// An object counts only after a HEAD read-back confirms it.

import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";
import { serviceUnavailable } from "./errors.js";

const EMPTY_HASH = createHash("sha256").update("").digest("hex");

function encodePath(path: string): string {
  return path
    .split("/")
    .map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

async function s3(
  method: "GET" | "PUT" | "HEAD" | "DELETE",
  key: string | null,
  options: { body?: Buffer; contentType?: string; copySource?: string } = {},
): Promise<Response> {
  const { endpoint, region, bucket, forcePathStyle, accessKeyId, secretAccessKey } = config.s3;
  const base = new URL(endpoint);
  const host = forcePathStyle ? base.host : `${bucket}.${base.host}`;
  const path = forcePathStyle ? `/${bucket}${key === null ? "" : `/${key}`}` : `/${key ?? ""}`;
  const canonicalUri = encodePath(path);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = options.body ? createHash("sha256").update(options.body).digest("hex") : EMPTY_HASH;
  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (options.copySource) headers["x-amz-copy-source"] = encodePath(`/${bucket}/${options.copySource}`);
  const signedNames = Object.keys(headers).sort();
  const canonicalHeaders = signedNames.map((name) => `${name}:${headers[name]}\n`).join("");
  const signedHeaders = signedNames.join(";");
  const canonical = [method, canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
  const signingKey = ["s3", "aws4_request"].reduce<Buffer>(
    (key, part) => hmac(key, part),
    hmac(hmac(`AWS4${secretAccessKey}`, day), region),
  );
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const requestHeaders: Record<string, string> = {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  delete requestHeaders.host;
  if (options.contentType) requestHeaders["content-type"] = options.contentType;
  try {
    return await fetch(`${base.protocol}//${host}${canonicalUri}`, {
      method,
      headers: requestHeaders,
      body: options.body,
      signal: AbortSignal.timeout(config.limits.FLAN_PROVIDER_TIMEOUT_MS),
    });
  } catch {
    throw serviceUnavailable();
  }
}

/** Makes sure the private bucket exists; applied on serve and retried when MinIO was away. */
export async function ensureBucket(): Promise<void> {
  const head = await s3("HEAD", null);
  if (head.status === 404) {
    const made = await s3("PUT", null);
    if (made.status !== 200 && made.status !== 409) throw serviceUnavailable();
  } else if (!head.ok) {
    throw serviceUnavailable();
  }
}

async function readBack(key: string, size: number): Promise<void> {
  const head = await s3("HEAD", key);
  if (!head.ok || Number(head.headers.get("content-length")) !== size) throw serviceUnavailable();
}

/** Writes an object and confirms it by reading its metadata back. */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const put = await s3("PUT", key, { body, contentType });
  await put.arrayBuffer();
  if (!put.ok) throw serviceUnavailable();
  await readBack(key, body.length);
}

/** Server-side copy into a new key, confirmed by a read-back of the same size as the source. */
export async function copyObject(source: string, target: string): Promise<void> {
  const head = await s3("HEAD", source);
  if (!head.ok) throw serviceUnavailable();
  const copy = await s3("PUT", target, { copySource: source });
  const reply = await copy.text();
  if (!copy.ok || reply.includes("<Error>")) throw serviceUnavailable();
  await readBack(target, Number(head.headers.get("content-length")));
}

export async function getObject(key: string): Promise<{ bytes: Buffer; contentType: string }> {
  const got = await s3("GET", key);
  if (!got.ok) throw serviceUnavailable();
  return {
    bytes: Buffer.from(await got.arrayBuffer()),
    contentType: got.headers.get("content-type") ?? "application/octet-stream",
  };
}

/** Removes objects written by a command that then failed to commit. */
export async function deleteObjects(keys: string[]): Promise<void> {
  await Promise.all(keys.map((key) => s3("DELETE", key).then((r) => r.arrayBuffer()).catch(() => undefined)));
}
