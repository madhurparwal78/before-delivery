import { createHash, createHmac } from "node:crypto";
import { config } from "../config.js";
import { ApiError } from "../errors.js";
import { markService } from "./health.js";

// A minimal S3 (SigV4) client for the configured MinIO bucket.
const endpoint = new URL(config.s3.endpoint);

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

function target(key: string): { url: string; host: string; path: string } {
  const path = config.s3.forcePathStyle
    ? `${endpoint.pathname.replace(/\/$/, "")}/${config.s3.bucket}${key ? `/${encodeKey(key)}` : ""}`
    : `${endpoint.pathname.replace(/\/$/, "")}/${encodeKey(key)}`;
  const host = config.s3.forcePathStyle ? endpoint.host : `${config.s3.bucket}.${endpoint.host}`;
  return { url: `${endpoint.protocol}//${host}${path}`, host, path: path || "/" };
}

async function request(method: string, key: string, body: Buffer | null, contentType: string | null, timeoutMs: number): Promise<Response> {
  const { url, host, path } = target(key);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = stamp.slice(0, 8);
  const payloadHash = sha256(body ?? "");
  const sent: Record<string, string> = { "x-amz-content-sha256": payloadHash, "x-amz-date": stamp };
  if (contentType) sent["content-type"] = contentType;
  const signed: Record<string, string> = { ...sent, host };
  const names = Object.keys(signed).sort();
  const canonical = [method, path, "", ...names.map((n) => `${n}:${signed[n]}`), "", names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256(canonical)].join("\n");
  let signingKey = hmac(`AWS4${config.s3.secretAccessKey}`, day);
  for (const part of [config.s3.region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  return fetch(url, {
    method,
    headers: { ...sent, authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` },
    body: body ? new Uint8Array(body) : null,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

// Every call reports reachability to the health monitor; an unreachable store is storage_unavailable.
async function call(method: string, key: string, body: Buffer | null, contentType: string | null, timeoutMs: number): Promise<Response> {
  try {
    const response = await request(method, key, body, contentType, timeoutMs);
    markService("storage", response.status < 500);
    return response;
  } catch {
    markService("storage", false);
    throw new ApiError("storage_unavailable");
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await call("PUT", key, body, contentType, 15_000);
  if (!response.ok) throw new ApiError("storage_unavailable");
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await call("GET", key, null, null, 15_000);
  if (!response.ok) throw new ApiError("storage_unavailable");
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(key: string, timeoutMs = 5_000): Promise<void> {
  const response = await call("DELETE", key, null, null, timeoutMs);
  if (!response.ok && response.status !== 404) throw new ApiError("storage_unavailable");
}

export async function bucketReachable(): Promise<boolean> {
  try {
    const response = await request("HEAD", "", null, null, 3_000);
    return response.ok;
  } catch {
    return false;
  }
}

export function objectKeys(workspaceId: string, messageId: string, attachmentId: string): { original: string; thumb: string } {
  const prefix = `attachments/${workspaceId}/${messageId}/${attachmentId}`;
  return { original: `${prefix}/original`, thumb: `${prefix}/thumb.jpg` };
}
