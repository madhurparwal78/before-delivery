// Object storage (MinIO, S3 API) with SigV4 signing. Objects are only ever streamed through authorised endpoints.

import { createHash, createHmac } from "node:crypto";
import { protocolTime } from "../clock.js";
import { config } from "../config.js";
import { storageUnavailable } from "../http/errors.js";

const { endpoint, region, bucket, forcePathStyle, accessKeyId, secretAccessKey } = config.storage;

export const agreementKey = (contractId: string): string => `contracts/${contractId}/agreement-signed.pdf`;
export const billOfSaleKey = (contractId: string): string => `contracts/${contractId}/bill-of-sale.pdf`;
export const conditionPhotoKey = (contractId: string, eventId: string, photoId: string): string =>
  `contracts/${contractId}/condition/${eventId}/${photoId}.jpg`;

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function encodeKey(key: string): string {
  return key.split("/").map((part) => encodeURIComponent(part)).join("/");
}

async function send(method: "GET" | "PUT" | "HEAD" | "DELETE", key: string, body?: Buffer,
  contentType?: string): Promise<Response> {
  const base = new URL(endpoint);
  const host = forcePathStyle ? base.host : `${bucket}.${base.host}`;
  const path = forcePathStyle ? `/${bucket}/${encodeKey(key)}` : `/${encodeKey(key)}`;
  const amzDate = protocolTime().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body ?? "");
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [method, path, "", names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), payloadHash]
    .join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonical)].join("\n");
  let signingKey = hmac(`AWS4${secretAccessKey}`, day);
  for (const part of [region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const { host: _host, ...sent } = headers;
  try {
    return await fetch(`${base.protocol}//${host}${path}`, {
      method, body, signal: AbortSignal.timeout(15_000),
      headers: { ...sent, authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` },
    });
  } catch {
    throw storageUnavailable();
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await send("PUT", key, body, contentType);
  if (!response.ok) throw storageUnavailable();
}

/** The object's bytes, or null when no object has that key. */
export async function getObject(key: string): Promise<Buffer | null> {
  const response = await send("GET", key);
  if (response.status === 404) return null;
  if (!response.ok) throw storageUnavailable();
  return Buffer.from(await response.arrayBuffer());
}

export async function objectExists(key: string): Promise<boolean> {
  const response = await send("HEAD", key);
  if (response.status === 404) return false;
  if (!response.ok) throw storageUnavailable();
  return true;
}

async function deleteObject(key: string): Promise<void> {
  const response = await send("DELETE", key);
  if (!response.ok && response.status !== 404) throw storageUnavailable();
}

/** Clean-up after a failed action: deletes every object the request wrote, best effort while storage is down. */
export async function deleteWritten(keys: readonly string[]): Promise<void> {
  for (const key of keys) {
    await deleteObject(key).catch((error: unknown) => console.error(`could not delete ${key}`, error));
  }
}
