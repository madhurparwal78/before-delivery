// MinIO object storage over the S3 API, signed with AWS Signature Version 4.

import { createHash, createHmac } from "node:crypto";
import { config } from "./config.ts";
import { reportService } from "./status.ts";

const { endpoint, region, bucket, forcePathStyle, accessKeyId, secretAccessKey } = config.storage;
const EMPTY_HASH = createHash("sha256").update("").digest("hex");

/** Storage did not answer (or answered with a server error). */
export class StorageUnavailable extends Error {}

function objectUrl(key: string): URL {
  const base = new URL(endpoint);
  const path = key.split("/").map(encodeURIComponent).join("/");
  if (forcePathStyle) return new URL(`${base.origin}/${bucket}${key ? `/${path}` : ""}`);
  return new URL(`${base.protocol}//${bucket}.${base.host}/${path}`);
}

const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();

async function signed(method: string, key: string, body: Buffer | null, timeoutMs: number, extra: Record<string, string> = {}): Promise<Response> {
  const url = objectUrl(key);
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = now.slice(0, 8);
  const payload = body ? createHash("sha256").update(body).digest("hex") : EMPTY_HASH;
  const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payload}\nx-amz-date:${now}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonical = [method, url.pathname, "", canonicalHeaders, signedHeaders, payload].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", now, scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
  let signingKey = hmac(`AWS4${secretAccessKey}`, day);
  for (const part of [region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  try {
    const response = await fetch(url, {
      method,
      headers: {
        ...extra,
        "x-amz-content-sha256": payload,
        "x-amz-date": now,
        authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
      ...(body ? { body: new Uint8Array(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status >= 500) throw new StorageUnavailable(`storage answered ${response.status}`);
    return response;
  } catch (error) {
    if (error instanceof StorageUnavailable) throw error;
    throw new StorageUnavailable("storage unreachable");
  }
}

async function expectOk(response: Response, what: string): Promise<void> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new StorageUnavailable(`${what} answered ${response.status}`);
  }
  await response.body?.cancel();
}

export async function putObject(key: string, bytes: Buffer, contentType: string): Promise<void> {
  await expectOk(await signed("PUT", key, bytes, 120_000, { "content-type": contentType }), "PUT");
}

/** The object's size as storage reports it (HEAD), or null when it does not exist. */
export async function objectSize(key: string): Promise<number | null> {
  const response = await signed("HEAD", key, null, 15_000);
  if (response.status === 404) return null;
  await expectOk(response, "HEAD");
  return Number(response.headers.get("content-length"));
}

export async function deleteObject(key: string): Promise<void> {
  const response = await signed("DELETE", key, null, 15_000);
  if (response.status !== 404) await expectOk(response, "DELETE");
}

/** The object's bytes as a stream response. */
export async function getObject(key: string): Promise<Response> {
  const response = await signed("GET", key, null, 120_000);
  if (!response.ok) {
    await response.body?.cancel();
    throw new StorageUnavailable(`GET answered ${response.status}`);
  }
  return response;
}

/** Health: the bucket answers a HEAD. Runs at start and every 5 seconds. */
export async function checkStorage(): Promise<void> {
  let up = false;
  try {
    const response = await signed("HEAD", "", null, 4_000);
    await response.body?.cancel();
    up = response.ok;
  } catch {
    up = false;
  }
  reportService("storage", up);
}
