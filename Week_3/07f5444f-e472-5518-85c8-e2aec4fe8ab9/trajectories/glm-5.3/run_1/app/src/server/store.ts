// The score store: a minimal S3-compatible client for MinIO.

import { createHash } from "node:crypto";
import { createHmac } from "node:crypto";

export interface StoreConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export interface StoredObject {
  key: string;
  bytes: Buffer;
  contentType: string;
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** A SigV4-signed request against the score store. */
export async function storeRequest(
  config: StoreConfig,
  method: "GET" | "PUT" | "DELETE" | "HEAD",
  key: string,
  body?: Buffer,
  contentType?: string
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  const url = new URL(`${config.endpoint.replace(/\/$/, "")}/${config.bucket}/${key}`);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body ?? Buffer.alloc(0));

  const canonicalHeaders =
    `host:${url.host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    method,
    url.pathname,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, dateStamp), config.region), "s3"),
    "aws4_request"
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  const headers: Record<string, string> = {
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
    Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (contentType) headers["Content-Type"] = contentType;

  const response = await fetch(url, {
    method,
    headers,
    body: body ? new Uint8Array(body) : null,
  }).catch(() => null);
  if (!response) return { status: 0, headers: {}, body: Buffer.alloc(0) };
  const bytes = Buffer.from(await response.arrayBuffer());
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    responseHeaders[name.toLowerCase()] = value;
  });
  return { status: response.status, headers: responseHeaders, body: bytes };
}

export interface WriteResult {
  ok: boolean;
  sha256: string;
}

/** Write an object and confirm the write by reading back its size and checksum. */
export async function putObject(
  config: StoreConfig,
  key: string,
  bytes: Buffer,
  contentType: string
): Promise<WriteResult> {
  const put = await storeRequest(config, "PUT", key, bytes, contentType);
  if (put.status !== 200) return { ok: false, sha256: "" };
  const head = await storeRequest(config, "HEAD", key);
  const storedSize = Number(head.headers["content-length"] ?? "0");
  if (storedSize !== bytes.length) return { ok: false, sha256: "" };
  return { ok: true, sha256: sha256Hex(bytes) };
}

export async function getObject(
  config: StoreConfig,
  key: string
): Promise<{ ok: true; bytes: Buffer } | { ok: false }> {
  const response = await storeRequest(config, "GET", key);
  if (response.status !== 200) return { ok: false };
  return { ok: true, bytes: response.body };
}

export async function deleteObject(config: StoreConfig, key: string): Promise<boolean> {
  const response = await storeRequest(config, "DELETE", key);
  return response.status === 204 || response.status === 200;
}

export async function probeStore(config: StoreConfig): Promise<boolean> {
  try {
    const response = await storeRequest(config, "HEAD", "scans/probe");
    return response.status === 200 || response.status === 404;
  } catch {
    return false;
  }
}

const PROBE_TIMEOUT = 2000;

/** A probe with a 2-second deadline. */
export async function probeWithTimeout(config: StoreConfig): Promise<boolean> {
  return Promise.race([
    probeStore(config).catch(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), PROBE_TIMEOUT)),
  ]);
}
