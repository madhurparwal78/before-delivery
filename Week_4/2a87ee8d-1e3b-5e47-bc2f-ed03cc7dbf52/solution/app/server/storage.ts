// MinIO through the S3 REST API, signed with AWS Signature Version 4.
import crypto from "node:crypto";
import { config } from "./config.js";

export class StorageDown extends Error {}

const { endpoint, region, bucket, forcePathStyle, accessKeyId, secretAccessKey } = config.s3;

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data).digest();
}

function sha256(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function encodeKey(key: string): string {
  return key.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function target(key: string): URL {
  const base = new URL(endpoint);
  if (forcePathStyle) return new URL(`${base.origin}/${bucket}/${encodeKey(key)}`);
  return new URL(`${base.protocol}//${bucket}.${base.host}/${encodeKey(key)}`);
}

async function signed(method: string, url: URL, body: Buffer, contentType?: string): Promise<Response> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [method, url.pathname, url.search.replace(/^\?/, ""), names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonical)}`;
  let key: Buffer = hmac(`AWS4${secretAccessKey}`, day);
  for (const part of [region, "s3", "aws4_request"]) key = hmac(key, part);
  const signature = crypto.createHmac("sha256", key).update(toSign).digest("hex");
  const sent = Object.fromEntries(Object.entries(headers).filter(([name]) => name !== "host"));
  try {
    return await fetch(url, {
      method,
      headers: { ...sent, Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` },
      ...(method === "PUT" ? { body } : {}),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new StorageDown((error as Error).message);
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await signed("PUT", target(key), body, contentType);
  if (!response.ok) throw new StorageDown(`PUT ${key}: ${response.status} ${(await response.text()).slice(0, 200)}`);
}

export async function getObject(key: string): Promise<Buffer | null> {
  const response = await signed("GET", target(key), Buffer.alloc(0));
  if (response.status === 404) return null;
  if (!response.ok) throw new StorageDown(`GET ${key}: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const response = await signed("DELETE", target(key), Buffer.alloc(0));
  if (!response.ok && response.status !== 404) throw new StorageDown(`DELETE ${key}: ${response.status}`);
}

export async function healthy(): Promise<boolean> {
  try {
    const response = await fetch(`${new URL(endpoint).origin}/minio/health/live`, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}
