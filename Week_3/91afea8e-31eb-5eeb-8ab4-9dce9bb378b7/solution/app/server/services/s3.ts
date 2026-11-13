import { createHash, createHmac } from "node:crypto";
import { config } from "../config.js";
import { ProviderUnavailable } from "./provider.js";

const TIMEOUT_MS = 8000;

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function encodePath(path: string): string {
  return path
    .split("/")
    .map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

async function signed(method: string, key: string, body: Uint8Array = new Uint8Array(), contentType?: string): Promise<Response> {
  const { endpoint, region, bucket, accessKeyId, secretAccessKey } = config.s3;
  const path = `/${bucket}${key ? `/${key}` : ""}`;
  const url = new URL(endpoint);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = createHash("sha256").update(body).digest("hex");
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonical = [
    method,
    encodePath(path),
    "",
    `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${createHash("sha256").update(canonical).digest("hex")}`;
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const headers: Record<string, string> = {
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (contentType) headers["Content-Type"] = contentType;
  try {
    return await fetch(`${endpoint}${encodePath(path)}`, {
      method,
      headers,
      body: method === "PUT" ? new Blob([body as BlobPart]) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new ProviderUnavailable(error instanceof Error ? error.message : "object store unreachable");
  }
}

let bucketReady = false;

async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  const response = await signed("PUT", "");
  if (!response.ok && response.status !== 409) throw new ProviderUnavailable(`bucket answered ${response.status}`);
  bucketReady = true;
}

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  await ensureBucket();
  const response = await signed("PUT", key, body, contentType);
  if (!response.ok) throw new ProviderUnavailable(`put ${key} answered ${response.status}`);
}

export async function getObject(key: string): Promise<Buffer | null> {
  const response = await signed("GET", key);
  if (response.status === 404) return null;
  if (!response.ok) throw new ProviderUnavailable(`get ${key} answered ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function objectExists(key: string): Promise<boolean> {
  const response = await signed("HEAD", key);
  if (response.status === 404) return false;
  if (!response.ok) throw new ProviderUnavailable(`head ${key} answered ${response.status}`);
  return true;
}

export async function deleteObject(key: string): Promise<void> {
  const response = await signed("DELETE", key);
  if (!response.ok && response.status !== 404) throw new ProviderUnavailable(`delete ${key} answered ${response.status}`);
}

export async function prepareBucket(): Promise<void> {
  try {
    await ensureBucket();
  } catch (error) {
    if (!(error instanceof ProviderUnavailable)) throw error;
  }
}
