import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";

/** Object storage could not be reached or refused the request. */
export class StorageError extends Error {}

const TIMEOUT_MS = 5000;

const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();

function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

function objectUrl(key: string | null): URL {
  const endpoint = new URL(config.s3.endpoint);
  const suffix = key === null ? "" : `/${encodePath(key)}`;
  if (config.s3.forcePathStyle) return new URL(`${endpoint.origin}/${config.s3.bucket}${suffix}`);
  return new URL(`${endpoint.protocol}//${config.s3.bucket}.${endpoint.host}${suffix || "/"}`);
}

async function signedFetch(method: string, key: string | null, body?: Buffer, contentType?: string): Promise<Response> {
  const url = objectUrl(key);
  const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = stamp.slice(0, 8);
  const payloadHash = sha256(body ?? "");
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": stamp,
  };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [
    method,
    url.pathname,
    "",
    ...names.map((n) => `${n}:${headers[n]}`),
    "",
    names.join(";"),
    payloadHash,
  ].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256(canonical)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, day), config.s3.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  const { host: _host, ...sent } = headers;
  try {
    return await fetch(url, {
      method,
      headers: { ...sent, authorization },
      body: body ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new StorageError(String(error));
  }
}

let bucketReady = false;

async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  const head = await signedFetch("HEAD", null);
  if (head.status === 404) {
    const created = await signedFetch("PUT", null);
    if (!created.ok && created.status !== 409) throw new StorageError(`create bucket ${created.status}`);
  } else if (!head.ok) throw new StorageError(`bucket ${head.status}`);
  bucketReady = true;
}

/** Stores an object and confirms it is there with the expected size. */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await ensureBucket();
  const put = await signedFetch("PUT", key, body, contentType);
  await put.arrayBuffer();
  if (!put.ok) throw new StorageError(`put ${put.status}`);
  const head = await signedFetch("HEAD", key);
  if (!head.ok || Number(head.headers.get("content-length")) !== body.length) throw new StorageError("object not confirmed");
}

export async function getObject(key: string): Promise<{ body: Buffer; contentType: string }> {
  const response = await signedFetch("GET", key);
  if (!response.ok) throw new StorageError(`get ${response.status}`);
  return {
    body: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
  };
}

export async function deleteObject(key: string): Promise<void> {
  const response = await signedFetch("DELETE", key);
  await response.arrayBuffer();
}

export async function storageUp(): Promise<boolean> {
  try {
    const response = await signedFetch("HEAD", null);
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}
