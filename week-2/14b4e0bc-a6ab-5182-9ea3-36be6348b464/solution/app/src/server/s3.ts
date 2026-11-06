import { createHash, createHmac } from "node:crypto";
import { config } from "./config.ts";

/** A minimal S3 client (AWS Signature V4) for the evidence store. */
const EMPTY_HASH = createHash("sha256").update("").digest("hex");

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function target(key: string | null): { url: string; host: string; path: string } {
  const endpoint = new URL(config.s3.endpoint);
  const encodedKey = key === null ? "" : `/${key.split("/").map(encodeSegment).join("/")}`;
  if (config.s3.forcePathStyle) {
    const path = `/${encodeSegment(config.s3.bucket)}${encodedKey}`;
    return { url: `${endpoint.origin}${path}`, host: endpoint.host, path };
  }
  const host = `${config.s3.bucket}.${endpoint.host}`;
  const path = encodedKey || "/";
  return { url: `${endpoint.protocol}//${host}${path}`, host, path };
}

function signedHeaders(method: string, host: string, path: string, payloadHash: string, extra: Record<string, string>) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate, ...extra };
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const canonical = [method, path, "", names.map((n) => `${n}:${lower[n].trim()}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
  let key: Buffer = hmac(`AWS4${config.s3.secretAccessKey}`, day);
  for (const part of [config.s3.region, "s3", "aws4_request"]) key = hmac(key, part);
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  const { host: _host, ...rest } = headers;
  return {
    ...rest,
    Authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
  };
}

async function request(method: string, key: string | null, timeoutMs: number, body?: Buffer, extra: Record<string, string> = {}): Promise<Response> {
  const { url, host, path } = target(key);
  const payloadHash = body ? createHash("sha256").update(body).digest("hex") : EMPTY_HASH;
  return fetch(url, {
    method,
    headers: signedHeaders(method, host, path, payloadHash, extra),
    body: body ? new Uint8Array(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export class StoreUnavailable extends Error {}

async function guarded(promise: Promise<Response>): Promise<Response> {
  try {
    return await promise;
  } catch (error) {
    throw new StoreUnavailable(String(error));
  }
}

/** Stores the bytes; resolves only once the store has confirmed the write (within 10 s). */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const res = await guarded(request("PUT", key, 10_000, body, { "content-type": contentType }));
  await res.arrayBuffer();
  if (!res.ok) throw new StoreUnavailable(`PUT ${res.status}`);
}

export async function deleteObject(key: string): Promise<void> {
  const res = await guarded(request("DELETE", key, 10_000));
  await res.arrayBuffer();
}

/** Opens the object; the caller streams or cancels the body. */
export async function getObject(key: string): Promise<Response> {
  const res = await guarded(request("GET", key, 10_000));
  if (!res.ok) {
    await res.body?.cancel();
    throw new StoreUnavailable(`GET ${res.status}`);
  }
  return res;
}

/** Health probe; creates the bucket when it is missing. */
export async function probeStore(): Promise<boolean> {
  try {
    const head = await request("HEAD", null, 3_000);
    if (head.status === 404) {
      const created = await request("PUT", null, 3_000);
      await created.arrayBuffer();
      return created.ok || created.status === 409;
    }
    return head.ok;
  } catch {
    return false;
  }
}
