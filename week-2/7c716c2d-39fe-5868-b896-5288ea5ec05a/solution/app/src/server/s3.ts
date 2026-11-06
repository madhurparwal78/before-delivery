// MinIO through the S3 REST API with AWS Signature Version 4.
import { createHash, createHmac } from "node:crypto";
import { Readable } from "node:stream";
import { config } from "./config.js";
import { ApiError } from "./errors.js";

const EMPTY_HASH = createHash("sha256").update("").digest("hex");

function encodeKey(key: string): string {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

function target(key: string): { url: string; host: string; path: string } {
  const endpoint = new URL(config.s3.endpoint);
  const bucket = config.s3.bucket;
  const objectPath = key ? `/${encodeKey(key)}` : "";
  if (config.s3.forcePathStyle) {
    const path = `/${bucket}${objectPath}`;
    return { url: `${endpoint.origin}${path}`, host: endpoint.host, path };
  }
  const host = `${bucket}.${endpoint.host}`;
  const path = objectPath || "/";
  return { url: `${endpoint.protocol}//${host}${path}`, host, path };
}

function sign(method: string, host: string, path: string, payloadHash: string, extra: Record<string, string>): Record<string, string> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate, ...extra };
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim()]));
  const canonical = [method, path, "", names.map((n) => `${n}:${lower[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
  let key: Buffer = createHmac("sha256", `AWS4${config.s3.secretAccessKey}`).update(day).digest();
  for (const part of [config.s3.region, "s3", "aws4_request"]) key = createHmac("sha256", key).update(part).digest();
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  const { host: _host, ...rest } = headers;
  return { ...rest, Authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` };
}

/** One signed request. The timeout covers the response headers; `cancel` aborts a body still streaming. */
async function request(method: string, key: string, body?: Buffer, extra: Record<string, string> = {}, timeoutMs = 10_000, cancel?: AbortSignal): Promise<Response> {
  const { url, host, path } = target(key);
  const payloadHash = body ? createHash("sha256").update(body).digest("hex") : EMPTY_HASH;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  cancel?.addEventListener("abort", () => controller.abort(), { once: true });
  try {
    return await fetch(url, { method, headers: sign(method, host, path, payloadHash, extra), body, signal: controller.signal });
  } catch {
    throw new ApiError("storage_unavailable");
  } finally {
    clearTimeout(timer);
  }
}

/** Creates the bucket when it does not exist yet. */
export async function ensureBucket(): Promise<void> {
  const head = await request("HEAD", "");
  if (head.ok) return;
  if (head.status !== 404) throw new ApiError("storage_unavailable");
  const created = await request("PUT", "");
  if (!created.ok && created.status !== 409) throw new ApiError("storage_unavailable");
}

export async function storageHealthy(): Promise<boolean> {
  try {
    return (await request("HEAD", "", undefined, {}, 3000)).ok;
  } catch {
    return false;
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await request("PUT", key, body, { "content-type": contentType });
  if (!response.ok) throw new ApiError("storage_unavailable");
}

export async function deleteObject(key: string): Promise<void> {
  const response = await request("DELETE", key);
  if (!response.ok && response.status !== 404) throw new ApiError("storage_unavailable");
}

/** Streams an object; aborting `cancel` (the client left) closes the MinIO body. */
export async function getObject(key: string, cancel: AbortSignal): Promise<Readable> {
  const response = await request("GET", key, undefined, {}, 10_000, cancel);
  if (!response.ok || !response.body) throw new ApiError("storage_unavailable");
  return Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>);
}
