// S3-compatible object storage (MinIO), signed with AWS Signature Version 4.
import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";

const REQUEST_TIMEOUT_MS = 8_000;
const EMPTY_SHA256 = createHash("sha256").update("").digest("hex");

export class StorageUnreachable extends Error {}
export class StorageChecksumRefused extends Error {}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

interface SignedRequest {
  method: "GET" | "PUT" | "HEAD" | "DELETE";
  key?: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: Uint8Array;
  payloadSha256?: string;
}

function target(key: string | undefined): { url: URL; canonicalPath: string } {
  const { endpoint, bucket, forcePathStyle } = config.storage;
  const base = new URL(endpoint);
  const keyPath = key === undefined ? "" : key.split("/").map(encodeSegment).join("/");
  if (forcePathStyle) {
    const canonicalPath = `/${encodeSegment(bucket)}${key === undefined ? "" : `/${keyPath}`}`;
    return { url: new URL(canonicalPath, base), canonicalPath };
  }
  const host = new URL(endpoint);
  host.hostname = `${bucket}.${host.hostname}`;
  const canonicalPath = `/${keyPath}`;
  return { url: new URL(canonicalPath, host), canonicalPath };
}

async function send(request: SignedRequest): Promise<Response> {
  const { region, accessKeyId, secretAccessKey } = config.storage;
  const { url, canonicalPath } = target(request.key);
  const query = Object.entries(request.query ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
  const canonicalQuery = query.map(([k, v]) => `${encodeSegment(k)}=${encodeSegment(v)}`).join("&");
  if (canonicalQuery) url.search = canonicalQuery;

  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = now.slice(0, 8);
  const payload = request.payloadSha256 ?? EMPTY_SHA256;
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payload,
    "x-amz-date": now,
    ...Object.fromEntries(Object.entries(request.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${String(headers[n]).trim()}\n`).join("");
  const signedHeaders = names.join(";");
  const canonical = [request.method, canonicalPath, canonicalQuery, canonicalHeaders, signedHeaders, payload].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", now, scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
  let signingKey = hmac(`AWS4${secretAccessKey}`, day);
  for (const part of [region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");

  const { host: _host, ...sent } = headers;
  try {
    return await fetch(url, {
      method: request.method,
      headers: {
        ...sent,
        "accept-encoding": "identity",
        authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
      body: request.body?.slice(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new StorageUnreachable(error instanceof Error ? error.message : String(error));
  }
}

async function expectOk(response: Response, what: string): Promise<void> {
  if (response.ok) return;
  const text = await response.text();
  if (response.status >= 500) throw new StorageUnreachable(`${what}: ${response.status}`);
  throw new Error(`${what} answered ${response.status}: ${text.slice(0, 300)}`);
}

/** Probe used by the service monitor: the bucket answers a signed HEAD. */
export async function probeBucket(): Promise<void> {
  const response = await send({ method: "HEAD" });
  await expectOk(response, "HEAD bucket");
}

/**
 * Writes the object with the declared SHA-256 as its S3 checksum, so storage itself refuses bytes
 * that do not match the declaration.
 */
export async function putObject(key: string, body: Uint8Array, declaredSha256: string, contentType: string): Promise<void> {
  const response = await send({
    method: "PUT",
    key,
    body,
    payloadSha256: sha256Hex(body),
    headers: {
      "content-type": contentType,
      "content-length": String(body.byteLength),
      "x-amz-checksum-sha256": Buffer.from(declaredSha256, "hex").toString("base64"),
    },
  });
  if (response.status === 400) {
    const text = await response.text();
    if (/Checksum|BadDigest|Digest/i.test(text)) throw new StorageChecksumRefused(text.slice(0, 200));
    throw new Error(`PUT ${key} answered 400: ${text.slice(0, 300)}`);
  }
  await expectOk(response, `PUT ${key}`);
}

/** Size and SHA-256 as storage reports them for the written object. */
export async function statObject(key: string): Promise<{ sizeBytes: number; sha256: string | null }> {
  const response = await send({ method: "HEAD", key, headers: { "x-amz-checksum-mode": "ENABLED" } });
  await expectOk(response, `HEAD ${key}`);
  const checksum = response.headers.get("x-amz-checksum-sha256");
  return {
    sizeBytes: Number(response.headers.get("content-length")),
    sha256: checksum === null ? null : Buffer.from(checksum, "base64").toString("hex"),
  };
}

/** Streams an object, passing a single byte range straight through. */
export async function getObject(key: string, range: string | undefined): Promise<Response> {
  const response = await send({ method: "GET", key, headers: range === undefined ? {} : { range } });
  if (response.status === 200 || response.status === 206 || response.status === 416) return response;
  await expectOk(response, `GET ${key}`);
  return response;
}

export async function deleteObject(key: string): Promise<void> {
  const response = await send({ method: "DELETE", key });
  if (response.status === 404) return;
  await expectOk(response, `DELETE ${key}`);
}

export async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const query: Record<string, string> = { "list-type": "2", prefix };
    if (token !== undefined) query["continuation-token"] = token;
    const response = await send({ method: "GET", query });
    await expectOk(response, `LIST ${prefix}`);
    const xml = await response.text();
    for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) keys.push(decodeXml(match[1] ?? ""));
    const next = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml);
    token = next?.[1] === undefined ? undefined : decodeXml(next[1]);
  } while (token !== undefined);
  return keys;
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
