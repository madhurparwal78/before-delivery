import { createHmac } from "node:crypto";
import { config } from "./config.ts";
import { sha256 } from "./hash.ts";
import { ApiError } from "./http.ts";

const TIMEOUT_MS = 8000;

const storageUnavailable = () =>
  new ApiError(503, "storage_unavailable", "File storage is unavailable. Try again when it returns.");

class StorageDown extends Error {}

const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

function encodePath(path: string): string {
  return path.split("/").map((p) => encodeURIComponent(p).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");
}

function target(key: string): URL {
  const { endpoint, bucket, forcePathStyle } = config.s3;
  const base = new URL(endpoint);
  if (forcePathStyle) base.pathname = `/${bucket}${key ? `/${encodePath(key)}` : ""}`;
  else {
    base.hostname = `${bucket}.${base.hostname}`;
    base.pathname = `/${encodePath(key)}`;
  }
  return base;
}

/** One signed S3 request (AWS Signature Version 4). Network failures become StorageDown. */
async function s3(method: "GET" | "PUT" | "HEAD", key: string, body?: Buffer, contentType?: string, timeoutMs = TIMEOUT_MS): Promise<Response> {
  const url = target(key);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body ?? "");
  const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [method, url.pathname, "", names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  let signingKey = hmac(`AWS4${config.s3.secretAccessKey}`, day);
  for (const part of [config.s3.region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const { host: _host, ...sent } = headers;
  try {
    return await fetch(url, {
      method,
      headers: { ...sent, authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` },
      body: body ? new Uint8Array(body) : null,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new StorageDown();
  }
}

let bucketReady = false;

async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  const head = await s3("HEAD", "");
  if (head.status === 404) {
    const made = await s3("PUT", "");
    if (!made.ok && made.status !== 409) throw new StorageDown();
  } else if (!head.ok) throw new StorageDown();
  bucketReady = true;
}

/** Creates the bucket at start if it is missing; an unreachable store is retried on first use. */
export async function prepareStorage(): Promise<void> {
  await ensureBucket().catch(() => undefined);
}

function asApiError(error: unknown): never {
  if (error instanceof StorageDown) throw storageUnavailable();
  throw error;
}

async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  try {
    await ensureBucket();
    const res = await s3("PUT", key, body, contentType);
    await res.arrayBuffer();
    if (!res.ok) throw new StorageDown();
  } catch (error) {
    asApiError(error);
  }
}

export async function getObject(key: string): Promise<Buffer> {
  try {
    await ensureBucket();
    const res = await s3("GET", key);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!res.ok) throw new StorageDown();
    return bytes;
  } catch (error) {
    asApiError(error);
  }
}

interface StoredFile {
  sizeBytes: number;
  sha256: string;
}

/** Writes an object, reads it back and confirms the stored size and SHA-256 match. */
export async function putConfirmed(key: string, body: Buffer, contentType: string): Promise<StoredFile> {
  await putObject(key, body, contentType);
  const stored = await getObject(key);
  const expected = { sizeBytes: body.length, sha256: sha256(body) };
  if (stored.length !== expected.sizeBytes || sha256(stored) !== expected.sha256) throw storageUnavailable();
  return expected;
}

export async function storageReachable(): Promise<boolean> {
  try {
    const res = await s3("HEAD", "", undefined, undefined, 2000);
    return res.status < 500;
  } catch {
    return false;
  }
}

