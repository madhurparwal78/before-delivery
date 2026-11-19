/**
 * S3-compatible object storage over SigV4. Objects are written with their
 * SHA-256 so that storage itself checks the bytes, and read back unchanged.
 */

import { createHash, createHmac } from "node:crypto";
import { config } from "../config.js";

const SERVICE = "s3";
const UNSIGNED_HEADERS = new Set(["authorization", "content-length", "user-agent"]);

export class StorageUnreachable extends Error {
  constructor(cause: unknown) {
    super(`Object storage did not answer: ${String(cause)}`);
  }
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function hexToBase64(hex: string): string {
  return Buffer.from(hex, "hex").toString("base64");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function encodeKey(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function amzDate(now: Date): { stamp: string; date: string } {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return { stamp, date: stamp.slice(0, 8) };
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function signRequest(
  method: string,
  key: string,
  queryParams: Record<string, string>,
  headers: Record<string, string>,
  payloadHash: string,
): SignedRequest {
  const { stamp, date } = amzDate(new Date());
  const endpoint = new URL(config.s3.endpoint);
  const basePath = config.s3.forcePathStyle
    ? `/${config.s3.bucket}${key ? `/${encodeKey(key)}` : ""}`
    : `${key ? `/${encodeKey(key)}` : "/"}`;
  const host = config.s3.forcePathStyle
    ? endpoint.host
    : `${config.s3.bucket}.${endpoint.host}`;

  const allHeaders: Record<string, string> = {
    ...headers,
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": stamp,
  };

  const signedNames = Object.keys(allHeaders)
    .map((name) => name.toLowerCase())
    .filter((name) => !UNSIGNED_HEADERS.has(name))
    .sort();
  const canonicalHeaders = signedNames
    .map((name) => {
      const entry = Object.entries(allHeaders).find(([k]) => k.toLowerCase() === name);
      return `${name}:${String(entry?.[1] ?? "").trim()}\n`;
    })
    .join("");
  const canonicalQuery = Object.keys(queryParams)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
    .join("&");

  const canonicalRequest = [
    method,
    basePath,
    canonicalQuery,
    canonicalHeaders,
    signedNames.join(";"),
    payloadHash,
  ].join("\n");

  const scope = `${date}/${config.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    stamp,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, date), config.s3.region), SERVICE),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  allHeaders.authorization =
    `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedNames.join(";")}, Signature=${signature}`;

  const search = canonicalQuery ? `?${canonicalQuery}` : "";
  return { url: `${endpoint.origin}${basePath}${search}`, headers: allHeaders };
}

async function send(
  method: string,
  key: string,
  options: {
    query?: Record<string, string>;
    headers?: Record<string, string>;
    body?: Uint8Array;
  } = {},
): Promise<Response> {
  const body = options.body;
  const payloadHash = body ? sha256Hex(body) : sha256Hex("");
  const signed = signRequest(
    method,
    key,
    options.query ?? {},
    options.headers ?? {},
    payloadHash,
  );
  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: body ? Buffer.from(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (cause) {
    throw new StorageUnreachable(cause);
  }
}

export interface StoredObjectFacts {
  sizeBytes: number;
  sha256Hex: string | null;
}

/** Writes the object, letting storage verify the bytes against the digest. */
export async function putObject(key: string, bytes: Uint8Array, digestHex: string): Promise<void> {
  const response = await send("PUT", key, {
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(bytes.byteLength),
      "x-amz-checksum-sha256": hexToBase64(digestHex),
    },
    body: bytes,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    if (response.status >= 500) throw new StorageUnreachable(`${response.status} ${text}`);
    throw new ObjectWriteRejected(`${response.status} ${text}`);
  }
  await response.arrayBuffer().catch(() => undefined);
}

export class ObjectWriteRejected extends Error {}

/** Reads back the object's size and checksum as object storage reports them. */
export async function headObject(key: string): Promise<StoredObjectFacts | null> {
  const response = await send("HEAD", key, {
    headers: { "x-amz-checksum-mode": "ENABLED" },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    if (response.status >= 500) throw new StorageUnreachable(response.status);
    return null;
  }
  const checksum = response.headers.get("x-amz-checksum-sha256");
  return {
    sizeBytes: Number(response.headers.get("content-length") ?? "0"),
    sha256Hex: checksum ? Buffer.from(checksum, "base64").toString("hex") : null,
  };
}

export async function getObject(
  key: string,
  range?: { start: number; end: number },
): Promise<Uint8Array | null> {
  const headers: Record<string, string> = {};
  if (range) headers.range = `bytes=${range.start}-${range.end}`;
  const response = await send("GET", key, { headers });
  if (response.status === 404) return null;
  if (!response.ok) {
    if (response.status >= 500) throw new StorageUnreachable(response.status);
    return null;
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const response = await send("DELETE", key);
  if (!response.ok && response.status !== 404 && response.status >= 500) {
    throw new StorageUnreachable(response.status);
  }
  await response.arrayBuffer().catch(() => undefined);
}

export async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const query: Record<string, string> = { "list-type": "2", prefix };
    if (token) query["continuation-token"] = token;
    const response = await send("GET", "", { query });
    if (!response.ok) throw new StorageUnreachable(response.status);
    const xml = await response.text();
    for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) {
      keys.push(decodeXml(match[1]));
    }
    const next = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml);
    token = next ? decodeXml(next[1]) : undefined;
  } while (token);
  return keys;
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** True when the bucket answers. Used by the service probe. */
export async function bucketReachable(): Promise<boolean> {
  try {
    const response = await send("HEAD", "");
    return response.status < 500;
  } catch {
    return false;
  }
}

export function assetObjectKey(
  tenantId: string,
  corridorId: string,
  assetId: string,
  path: string,
): string {
  return `tenants/${tenantId}/corridors/${corridorId}/assets/${assetId}/${path}`;
}

export function assetPrefix(tenantId: string, corridorId: string, assetId: string): string {
  return `tenants/${tenantId}/corridors/${corridorId}/assets/${assetId}/`;
}

export function evidenceObjectKey(
  tenantId: string,
  corridorId: string,
  setId: string,
): string {
  return `tenants/${tenantId}/corridors/${corridorId}/findings-sets/${setId}/evidence.json`;
}
