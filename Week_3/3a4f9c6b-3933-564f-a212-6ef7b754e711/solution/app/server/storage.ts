// MinIO object storage over the S3 API, signed with AWS Signature Version 4.
import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";
import { ApiError } from "./errors.js";

const { endpoint, region, bucket, forcePathStyle, accessKeyId, secretAccessKey } = config.storage;
const TIMEOUT_MS = 5_000;

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function target(key: string): URL {
  const base = new URL(endpoint);
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  if (forcePathStyle) return new URL(`${base.origin}/${bucket}${key ? `/${encodedKey}` : ""}`);
  return new URL(`${base.protocol}//${bucket}.${base.host}/${encodedKey}`);
}

async function signedFetch(method: "GET" | "PUT" | "HEAD", key: string, payload?: Buffer): Promise<Response> {
  const url = target(key);
  const now = new Date().toISOString().replace(/[-:]|\.\d{3}/g, "");
  const day = now.slice(0, 8);
  const payloadHash = createHash("sha256").update(payload ?? Buffer.alloc(0)).digest("hex");
  const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": now };
  const signedHeaders = Object.keys(headers).join(";");
  const canonical = [method, url.pathname, "", ...Object.entries(headers).map(([k, v]) => `${k}:${v}`), "", signedHeaders, payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", now, scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
  let signingKey: Buffer = hmac(`AWS4${secretAccessKey}`, day);
  for (const part of [region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = hmac(signingKey, toSign).toString("hex");
  const { host: _host, ...sent } = headers;
  return fetch(url, {
    method,
    body: payload,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      ...sent,
      ...(payload ? { "Content-Type": "application/json" } : {}),
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  });
}

/** Stores an object; throws when storage cannot be reached or refuses the write. */
export async function putObject(key: string, payload: Buffer, unreachable: string): Promise<void> {
  const response = await signedFetch("PUT", key, payload).catch(() => null);
  if (!response?.ok) throw new ApiError("storage_unavailable", unreachable);
}

/** Reads an object back; throws when storage cannot be reached or does not hold it. */
export async function getObject(key: string, unreachable: string): Promise<Buffer> {
  const response = await signedFetch("GET", key).catch(() => null);
  if (!response?.ok) throw new ApiError("storage_unavailable", unreachable);
  return Buffer.from(await response.arrayBuffer());
}

export async function storageReachable(): Promise<boolean> {
  const response = await signedFetch("HEAD", "").catch(() => null);
  return response?.ok ?? false;
}
