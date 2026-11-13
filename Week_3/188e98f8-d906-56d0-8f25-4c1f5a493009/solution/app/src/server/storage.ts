import { createHash, createHmac } from "node:crypto";
import { config } from "./config";

const TIMEOUT_MS = 5000;

const sha256Hex = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Uint8Array | string, data: string) => createHmac("sha256", key).update(data).digest();
const encode = (path: string) => path.split("/").map((part) => encodeURIComponent(part)).join("/");

interface Signed {
  url: string;
  headers: Record<string, string>;
}

function sign(method: string, key: string | null, body: Uint8Array, extra: Record<string, string>): Signed {
  const { endpoint, bucket, region, forcePathStyle, accessKeyId, secretAccessKey } = config.s3;
  const base = new URL(endpoint);
  const host = forcePathStyle ? base.host : `${bucket}.${base.host}`;
  const path = (forcePathStyle ? `/${bucket}` : "") + (key === null ? "" : `/${key}`) || "/";
  const now = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = now.slice(0, 8);
  const headers: Record<string, string> = {
    ...extra,
    host,
    "x-amz-content-sha256": sha256Hex(body),
    "x-amz-date": now,
  };
  const names = Object.keys(headers).sort();
  const canonical = [
    method,
    encode(path),
    "",
    names.map((name) => `${name}:${headers[name]}\n`).join(""),
    names.join(";"),
    headers["x-amz-content-sha256"],
  ].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", now, scope, sha256Hex(canonical)].join("\n");
  let derived: Uint8Array | string = `AWS4${secretAccessKey}`;
  for (const part of [day, region, "s3", "aws4_request"]) derived = hmac(derived, part);
  const signature = createHmac("sha256", derived).update(toSign).digest("hex");
  headers["authorization"] =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  return { url: `${base.protocol}//${host}${encode(path)}`, headers };
}

async function call(method: string, key: string | null, body: Uint8Array, extra: Record<string, string> = {}) {
  const { url, headers } = sign(method, key, body, extra);
  const { host: _host, ...sendable } = headers;
  return fetch(url, {
    method,
    headers: sendable,
    body: body.length > 0 ? new Uint8Array(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/** Raised for every failure to write or to confirm; the API maps it to 503 storage_unavailable. */
export class StorageUnavailable extends Error {}

interface StoredObject {
  bytes: Buffer;
  contentType: string;
}

export async function putObject(key: string, bytes: Buffer, contentType: string): Promise<void> {
  try {
    const response = await call("PUT", key, bytes, { "content-type": contentType });
    await response.arrayBuffer();
    if (!response.ok) throw new StorageUnavailable(`PUT ${response.status}`);
  } catch (error) {
    throw error instanceof StorageUnavailable ? error : new StorageUnavailable(String(error));
  }
}

export async function getObject(key: string): Promise<StoredObject> {
  try {
    const response = await call("GET", key, new Uint8Array());
    if (!response.ok) {
      await response.arrayBuffer();
      throw new StorageUnavailable(`GET ${response.status}`);
    }
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
    };
  } catch (error) {
    throw error instanceof StorageUnavailable ? error : new StorageUnavailable(String(error));
  }
}

/** Storage reports an object at the key whose size and SHA-256 equal the expected ones. */
export async function confirmObject(key: string, size: number, sha256: string): Promise<void> {
  const stored = await getObject(key);
  if (stored.bytes.length !== size || sha256Hex(stored.bytes) !== sha256) {
    throw new StorageUnavailable("stored object does not match");
  }
}

async function ensureBucket(): Promise<void> {
  const head = await call("HEAD", null, new Uint8Array());
  await head.arrayBuffer();
  if (head.ok) return;
  const { region } = config.s3;
  const body =
    region === "us-east-1"
      ? new Uint8Array()
      : new TextEncoder().encode(
          `<CreateBucketConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><LocationConstraint>${region}</LocationConstraint></CreateBucketConfiguration>`,
        );
  const created = await call("PUT", null, body);
  await created.arrayBuffer();
  if (!created.ok && created.status !== 409) throw new StorageUnavailable(`create bucket ${created.status}`);
}

/** Makes sure the bucket exists; retries in the background while storage is unreachable. */
export async function keepBucketReady(): Promise<void> {
  for (;;) {
    try {
      await ensureBucket();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}
