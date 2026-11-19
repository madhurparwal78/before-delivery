import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";
import { fail } from "./errors.js";

/** Object storage over the S3 API (SigV4): every upload and every generated download lives here. */

const { endpoint, region, bucket, pathStyle, accessKeyId, secretAccessKey } = config.storage;
const REQUEST_TIMEOUT_MS = 10_000;

const sha256 = (data: Uint8Array | string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Uint8Array | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();

function objectUrl(key: string): URL {
  const base = new URL(endpoint);
  const encoded = key.split("/").map((part) => encodeURIComponent(part)).join("/");
  if (pathStyle) return new URL(`${base.origin}/${bucket}${encoded === "" ? "" : `/${encoded}`}`);
  return new URL(`${base.protocol}//${bucket}.${base.host}/${encoded}`);
}

async function send(method: string, key: string, body: Uint8Array = new Uint8Array(), timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const url = objectUrl(key);
  const now = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = now.slice(0, 8);
  const payloadHash = sha256(body);
  const signed: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": now };
  const names = Object.keys(signed).sort();
  const canonical = [method, url.pathname, "", names.map((name) => `${name}:${signed[name]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", now, scope, sha256(canonical)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const headers = {
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": now,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
  };
  return fetch(url, { method, headers, body: method === "PUT" && body.length > 0 ? body : undefined, signal: AbortSignal.timeout(timeoutMs) });
}

async function attempt<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch {
    return fail("storage_unavailable");
  }
}

export async function ensureBucket(): Promise<void> {
  const response = await send("PUT", "");
  if (!response.ok && response.status !== 409) throw new Error(`bucket ${bucket}: ${response.status}`);
}

/** True when the bucket answers within the time limit (a missing bucket is created on the way). */
export async function storageReachable(timeoutMs: number): Promise<boolean> {
  try {
    const response = await send("HEAD", "", new Uint8Array(), timeoutMs);
    if (response.status === 404) await ensureBucket();
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

export function putObject(key: string, bytes: Uint8Array): Promise<void> {
  return attempt(async () => {
    let response = await send("PUT", key, bytes);
    if (response.status === 404) {
      await ensureBucket();
      response = await send("PUT", key, bytes);
    }
    if (!response.ok) throw new Error(`put ${key}: ${response.status}`);
  });
}

export function getObject(key: string): Promise<Buffer> {
  return attempt(async () => {
    const response = await send("GET", key);
    if (!response.ok) throw new Error(`get ${key}: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  });
}
