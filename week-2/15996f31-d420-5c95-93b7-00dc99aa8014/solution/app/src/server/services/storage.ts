// MinIO over the S3 API (SigV4 signed with node:crypto). Unreachable → 503 storage_unavailable.

import { createHash, createHmac } from "node:crypto";
import { config } from "../config.js";
import { storageUnavailable } from "../http.js";

const { endpoint, region, bucket, forcePathStyle, accessKeyId, secretAccessKey } = config.s3;

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function encodeKey(key: string): string {
  return key.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function objectUrl(key: string): URL {
  const base = new URL(endpoint);
  if (forcePathStyle) return new URL(`${base.origin}${base.pathname.replace(/\/$/, "")}/${bucket}/${encodeKey(key)}`);
  return new URL(`${base.protocol}//${bucket}.${base.host}${base.pathname.replace(/\/$/, "")}/${encodeKey(key)}`);
}

async function signedFetch(method: "PUT" | "GET" | "DELETE", key: string, body?: Buffer, contentType?: string): Promise<Response> {
  const url = objectUrl(key);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body ?? "");
  const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [method, url.pathname, "", names.map((name) => `${name}:${headers[name]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonical)}`;
  let signingKey = hmac(`AWS4${secretAccessKey}`, day);
  for (const part of [region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const { host: _host, ...sent } = headers;
  try {
    return await fetch(url, {
      method,
      headers: { ...sent, Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` },
      body,
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw storageUnavailable();
  }
}

async function expectOk(response: Response, what: string): Promise<void> {
  if (response.status >= 500) throw storageUnavailable();
  if (!response.ok) throw new Error(`storage ${what} answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await expectOk(await signedFetch("PUT", key, body, contentType), "put");
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await signedFetch("GET", key);
  await expectOk(response, "get");
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const response = await signedFetch("DELETE", key);
  if (response.status !== 404) await expectOk(response, "delete");
}
