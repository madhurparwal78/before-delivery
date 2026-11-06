// MinIO over the S3 API with SigV4. Every call reaches MinIO afresh, so uploads recover without a restart.
import { createHash, createHmac } from "node:crypto";
import { config } from "./config";
import { unavailable } from "./http";

const { endpoint, region, bucket, accessKeyId, secretAccessKey, forcePathStyle } = config.s3;
let bucketReady = false;

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function encodeKey(key: string): string {
  return key.split("/").map((part) => encodeURIComponent(part)).join("/");
}

async function s3(method: string, key: string | null, body: Buffer = Buffer.alloc(0), contentType?: string): Promise<Response> {
  const base = new URL(endpoint);
  const host = forcePathStyle ? base.host : `${bucket}.${base.host}`;
  const path = forcePathStyle ? `/${bucket}${key === null ? "" : `/${encodeKey(key)}`}` : key === null ? "/" : `/${encodeKey(key)}`;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (contentType) headers["content-type"] = contentType;
  const signedNames = Object.keys(headers).sort();
  const canonical = [method, path, "", signedNames.map((n) => `${n}:${headers[n]}\n`).join(""), signedNames.join(";"), payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  let signingKey = hmac(`AWS4${secretAccessKey}`, day);
  for (const part of [region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const { host: _host, ...sent } = headers;
  return fetch(`${base.protocol}//${host}${path}`, {
    method,
    headers: {
      ...sent,
      authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedNames.join(";")}, Signature=${signature}`,
    },
    body: method === "PUT" ? new Uint8Array(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
}

/** Creates the bucket when it is missing. Failures surface as storage_unavailable. */
export async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  const head = await s3("HEAD", null);
  if (head.status === 404) {
    const made = await s3("PUT", null);
    if (!made.ok && made.status !== 409) throw new Error(`create bucket: ${made.status}`);
  } else if (!head.ok) {
    throw new Error(`head bucket: ${head.status}`);
  }
  bucketReady = true;
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    await ensureBucket();
    return await work();
  } catch (error) {
    bucketReady = false;
    console.error(`storage: ${(error as Error).message}`);
    throw unavailable("storage_unavailable");
  }
}

export function putObject(key: string, data: Buffer, contentType: string): Promise<void> {
  return guarded(async () => {
    const res = await s3("PUT", key, data, contentType);
    if (!res.ok) throw new Error(`put ${key}: ${res.status}`);
  });
}

export function getObject(key: string): Promise<Buffer> {
  return guarded(async () => {
    const res = await s3("GET", key);
    if (!res.ok) throw new Error(`get ${key}: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  });
}

export function deleteObject(key: string): Promise<void> {
  return guarded(async () => {
    const res = await s3("DELETE", key);
    if (!res.ok && res.status !== 404) throw new Error(`delete ${key}: ${res.status}`);
  });
}
