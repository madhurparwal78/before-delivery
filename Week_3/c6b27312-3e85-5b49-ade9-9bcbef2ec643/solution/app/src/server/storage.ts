// MinIO / S3 over fetch with Signature V4. Any failure to reach the store raises StorageUnavailable.
import { compareText } from "../shared/order";
import { createHash, createHmac } from "node:crypto";
import { config } from "./config";
import { StorageUnavailable } from "./errors";

const REQUEST_TIMEOUT_MS = 5000;
const EMPTY_HASH = createHash("sha256").update("").digest("hex");

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function encodePath(path: string): string {
  return path.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function target(key: string): { url: URL; path: string } {
  const endpoint = new URL(config.s3.endpoint);
  const objectPath = key === "" ? "" : `/${encodePath(key)}`;
  if (config.s3.forcePathStyle) {
    const path = `/${config.s3.bucket}${objectPath}`;
    return { url: new URL(path, endpoint), path };
  }
  endpoint.hostname = `${config.s3.bucket}.${endpoint.hostname}`;
  return { url: new URL(objectPath || "/", endpoint), path: objectPath || "/" };
}

function signedHeaders(method: string, url: URL, path: string, payloadHash: string): Record<string, string> {
  const now = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = now.slice(0, 8);
  const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": now };
  const names = Object.keys(headers).sort(compareText);
  const canonical = [method, path, "", ...names.map((n) => `${n}:${headers[n]}`), "", names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", now, scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
  const signingKey = [day, config.s3.region, "s3", "aws4_request"].reduce<Buffer | string>((key, part) => hmac(key, part), `AWS4${config.s3.secretAccessKey}`);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  return headers;
}

async function send(method: string, key: string, body?: Buffer, contentType?: string, signal?: AbortSignal): Promise<Response> {
  const { url, path } = target(key);
  const headers = signedHeaders(method, url, path, body ? createHash("sha256").update(body).digest("hex") : EMPTY_HASH);
  if (contentType) headers["content-type"] = contentType;
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method, headers, body, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (response.status >= 500) throw new StorageUnavailable(`storage answered ${response.status}`);
    return response;
  } catch (error) {
    if (signal?.aborted) throw error;
    throw error instanceof StorageUnavailable ? error : new StorageUnavailable((error as Error).message);
  }
}

async function expectOk(response: Response, what: string): Promise<void> {
  if (!response.ok) throw new StorageUnavailable(`${what} answered ${response.status}: ${await response.text()}`);
  await response.arrayBuffer();
}

/** Writes an object and reads its metadata back to confirm it is present. */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await expectOk(await send("PUT", key, body, contentType), `put ${key}`);
  await confirmObject(key);
}

export async function confirmObject(key: string): Promise<void> {
  const response = await send("HEAD", key);
  if (response.status !== 200) throw new StorageUnavailable(`${key} is not present (${response.status})`);
}

/** The object's bytes, or null when it does not exist. */
export async function getObject(key: string): Promise<Buffer | null> {
  const response = await send("GET", key);
  if (response.status === 404) return null;
  if (!response.ok) throw new StorageUnavailable(`get ${key} answered ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/** Whether the store answers at all: used by the health check. */
export async function storageReachable(): Promise<boolean> {
  try {
    const response = await send("HEAD", "");
    await response.arrayBuffer();
    return response.status < 500;
  } catch {
    return false;
  }
}

/** Creates the bucket when it is missing; best effort, since the credentials may not allow it. */
export async function ensureBucket(): Promise<void> {
  try {
    const head = await send("HEAD", "");
    await head.arrayBuffer();
    if (head.status === 404) await send("PUT", "").then((response) => response.arrayBuffer());
  } catch {
    // Storage-degraded mode: the health check reports it.
  }
}
