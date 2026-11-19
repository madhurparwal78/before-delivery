// MinIO through the S3 REST API with Signature V4. The bucket stays private; bytes reach browsers through the app.

import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";
import { fail } from "./http.js";

const { s3 } = config;
const TIMEOUT_MS = 8000;

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function encodeKey(key: string): string {
  return key.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function target(key: string): URL {
  const base = new URL(s3.endpoint);
  if (s3.forcePathStyle) return new URL(`${base.origin}/${s3.bucket}/${encodeKey(key)}`);
  return new URL(`${base.protocol}//${s3.bucket}.${base.host}/${encodeKey(key)}`);
}

function unavailable(): never {
  fail(503, "storage_unavailable", "Storage is unreachable. Try again when it returns.");
}

async function send(method: "GET" | "PUT" | "DELETE" | "HEAD", key: string, body?: Buffer, contentType?: string): Promise<Response> {
  const url = target(key);
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
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
    names.map((name) => `${name}:${headers[name]}\n`).join(""),
    names.join(";"),
    payloadHash,
  ].join("\n");
  const scope = `${day}/${s3.region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${sha256(canonical)}`;
  let signingKey = hmac(`AWS4${s3.secretAccessKey}`, day);
  for (const part of [s3.region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const { host: _host, ...sent } = headers;
  try {
    return await fetch(url, {
      method,
      headers: {
        ...sent,
        authorization: `AWS4-HMAC-SHA256 Credential=${s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
      },
      body: body ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    unavailable();
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await send("PUT", key, body, contentType);
  await response.arrayBuffer();
  if (!response.ok) unavailable();
}

/** The object's bytes, or null when it does not exist. */
export async function getObject(key: string): Promise<Buffer | null> {
  const response = await send("GET", key);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (response.status === 404) return null;
  if (!response.ok) unavailable();
  return bytes;
}

export async function objectExists(key: string): Promise<boolean> {
  const response = await send("HEAD", key);
  await response.arrayBuffer();
  if (response.status === 404) return false;
  if (!response.ok) unavailable();
  return true;
}

export async function deleteObject(key: string): Promise<void> {
  const response = await send("DELETE", key);
  await response.arrayBuffer();
  if (!response.ok && response.status !== 404) unavailable();
}
