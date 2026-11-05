// MinIO over the S3 API, signed with AWS Signature Version 4. The bucket already exists.
import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";
import { ApiError } from "./errors.js";

const TIMEOUT_MS = 15_000;

const storageUnavailable = () =>
  new ApiError(503, "storage_unavailable", "File storage is unavailable.");

const sha256Hex = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

function encodeKey(key: string): string {
  return key.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function target(key: string): URL {
  const { endpoint, bucket, forcePathStyle } = config.storage;
  const base = new URL(endpoint);
  if (forcePathStyle) return new URL(`${base.origin}/${bucket}/${encodeKey(key)}`);
  return new URL(`${base.protocol}//${bucket}.${base.host}/${encodeKey(key)}`);
}

async function send(method: string, key: string, body?: Buffer, contentType?: string): Promise<Response> {
  const { region, accessKeyId, secretAccessKey } = config.storage;
  const url = target(key);
  const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = stamp.slice(0, 8);
  const payloadHash = sha256Hex(body ?? "");
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": stamp,
    ...(contentType ? { "content-type": contentType } : {}),
  };
  const names = Object.keys(headers).sort();
  const canonical = [
    method,
    url.pathname,
    "",
    names.map((n) => `${n}:${headers[n]}\n`).join(""),
    names.join(";"),
    payloadHash,
  ].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${sha256Hex(canonical)}`;
  let signingKey: Buffer = hmac(`AWS4${secretAccessKey}`, day);
  for (const part of [region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const { host: _host, ...sent } = headers;
  try {
    return await fetch(url, {
      method,
      headers: {
        ...sent,
        Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
      },
      body: body === undefined ? undefined : new Uint8Array(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw storageUnavailable();
  }
}

/** Resolves only once MinIO acknowledges the write. */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await send("PUT", key, body, contentType);
  await response.arrayBuffer();
  if (!response.ok) throw storageUnavailable();
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await send("GET", key);
  const data = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw storageUnavailable();
  return data;
}

/** True once MinIO confirms the object is gone. */
export async function deleteObject(key: string): Promise<boolean> {
  try {
    const response = await send("DELETE", key);
    await response.arrayBuffer();
    return response.ok;
  } catch {
    return false;
  }
}

/** True while MinIO holds the object, false once it answers that the object is gone. */
export async function objectExists(key: string): Promise<boolean> {
  const response = await send("HEAD", key);
  await response.arrayBuffer();
  if (response.status === 404) return false;
  if (!response.ok) throw storageUnavailable();
  return true;
}
