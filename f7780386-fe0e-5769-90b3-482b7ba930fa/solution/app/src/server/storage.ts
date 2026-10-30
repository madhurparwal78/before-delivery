// MinIO through the S3 API, signed with AWS Signature Version 4. The bucket stays private.

import { createHash, createHmac } from "node:crypto";
import type { Config } from "./config.js";
import { unavailable } from "./errors.js";

let settings: Config["s3"] | null = null;

export function configureStorage(s3: Config["s3"]): void {
  settings = s3;
}

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

interface S3Response {
  status: number;
  body: Buffer;
  contentType: string | null;
}

/** Signs the S3 request with the wall clock: AWS signatures must carry real UTC time, not the business clock. */
async function s3(method: "GET" | "PUT" | "HEAD", key: string, body?: Buffer, contentType?: string): Promise<S3Response> {
  if (!settings) throw unavailable("storage_unavailable");
  const endpoint = new URL(settings.endpoint);
  const path = settings.forcePathStyle ? `/${settings.bucket}/${encodeKey(key)}` : `/${encodeKey(key)}`;
  const host = settings.forcePathStyle ? endpoint.host : `${settings.bucket}.${endpoint.host}`;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = stamp.slice(0, 8);
  const payloadHash = sha256(body ?? "");
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": stamp };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [method, path, "", names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${settings.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256(canonical)].join("\n");
  let signingKey = hmac(`AWS4${settings.secretAccessKey}`, day);
  for (const part of [settings.region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const { host: _host, ...sent } = headers;
  const url = `${endpoint.protocol}//${host}${path}`;
  try {
    const response = await fetch(url, {
      method,
      headers: {
        ...sent,
        Authorization: `AWS4-HMAC-SHA256 Credential=${settings.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
      },
      body: body ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (response.status >= 500) throw unavailable("storage_unavailable");
    return { status: response.status, body: bytes, contentType: response.headers.get("content-type") };
  } catch {
    throw unavailable("storage_unavailable");
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const result = await s3("PUT", key, body, contentType);
  if (result.status !== 200) throw unavailable("storage_unavailable");
}

/** The stored bytes, or null when the object does not exist. */
export async function getObject(key: string): Promise<Buffer | null> {
  const result = await s3("GET", key);
  if (result.status === 404) return null;
  if (result.status !== 200) throw unavailable("storage_unavailable");
  return result.body;
}

export async function objectExists(key: string): Promise<boolean> {
  const result = await s3("HEAD", key);
  if (result.status === 404) return false;
  if (result.status !== 200) throw unavailable("storage_unavailable");
  return true;
}
