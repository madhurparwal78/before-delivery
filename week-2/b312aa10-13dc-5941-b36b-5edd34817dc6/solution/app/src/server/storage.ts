// S3-compatible object storage over SigV4. The bucket is private; the server streams every file.

import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";
import { variantError, type ApiError } from "./http.js";
import { send, type Reply } from "./outbound.js";
import { markService } from "./status.js";

const TIMEOUT_MS = 8000;

/** 503 storage_unavailable, with the upload or the download copy. */
export const storageUnavailable = (variant: "storage_unavailable_upload" | "storage_unavailable_download"): ApiError =>
  variantError(503, variant, []);

const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();

function objectUrl(key: string): URL {
  const { endpoint, bucket, forcePathStyle } = config.storage;
  const base = new URL(endpoint);
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  if (forcePathStyle) return new URL(`${base.origin}/${bucket}/${encodedKey}`);
  return new URL(`${base.protocol}//${bucket}.${base.host}/${encodedKey}`);
}

async function signedRequest(method: string, url: URL, body?: Buffer, contentType?: string): Promise<Reply> {
  const { region, accessKeyId, secretAccessKey } = config.storage;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body ?? "");
  const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [
    method, url.pathname, url.searchParams.toString(),
    names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), payloadHash,
  ].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonical)}`;
  let key: Buffer = hmac(`AWS4${secretAccessKey}`, day);
  for (const part of [region, "s3", "aws4_request"]) key = hmac(key, part);
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  const { host: _host, ...sent } = headers;
  return send(url, {
    method,
    headers: { ...sent, authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` },
    body,
    timeoutMs: TIMEOUT_MS,
  });
}

/**
 * Any network failure, 5xx or refused signature (an address that is not our bucket) counts as
 * storage being unavailable; the configured address is retried every time.
 */
async function call(method: string, key: string, body?: Buffer, contentType?: string): Promise<Reply> {
  let response: Reply;
  try {
    response = await signedRequest(method, objectUrl(key), body, contentType);
  } catch {
    markService("storage", false);
    throw new StorageDown();
  }
  if (response.status >= 500 || response.status === 401 || response.status === 403) {
    markService("storage", false);
    throw new StorageDown();
  }
  markService("storage", true);
  return response;
}

export class StorageDown extends Error {}

export async function putObject(key: string, data: Buffer, contentType: string): Promise<void> {
  const response = await call("PUT", key, data, contentType);
  if (!response.ok) throw new Error(`storage PUT answered ${response.status}`);
}

export async function getObject(key: string): Promise<Buffer | null> {
  const response = await call("GET", key);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`storage GET answered ${response.status}`);
  return response.body;
}

export async function deleteObject(key: string): Promise<void> {
  await call("DELETE", key);
}

/**
 * Reachability probe for the status monitor: up only when the bucket answers our signed request.
 * A store that accepts our signature but has no such bucket gets it created, so an instance whose
 * bucket was never provisioned while storage was unreachable still recovers on its own.
 */
export async function probeStorage(): Promise<boolean> {
  try {
    const response = await signedRequest("HEAD", objectUrl(""));
    if (response.status !== 404) return response.ok;
    const { region } = config.storage;
    const location = region === "us-east-1" ? undefined : Buffer.from(
      `<CreateBucketConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><LocationConstraint>${region}</LocationConstraint></CreateBucketConfiguration>`,
    );
    const created = await signedRequest("PUT", objectUrl(""), location, location && "application/xml");
    return created.ok || created.status === 409;
  } catch {
    return false;
  }
}

export const documentKey = (kitchenId: string, memberId: string, documentId: string): string =>
  `kitchens/${kitchenId}/members/${memberId}/documents/${documentId}`;
export const sanitationKey = (kitchenId: string, month: string): string => `kitchens/${kitchenId}/sanitation/${month}.pdf`;
