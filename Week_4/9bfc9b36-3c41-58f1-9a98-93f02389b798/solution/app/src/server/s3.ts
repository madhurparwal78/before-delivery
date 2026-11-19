/** A small S3 client (Signature V4, path style) for the one bucket: cut sheets and tape photographs. */
import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";

export class StoreUnavailable extends Error {}

const sha256Hex = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();

function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

interface Exchange {
  status: number;
  body: Buffer;
  headers: Headers;
}

async function send(method: string, key: string, body: Buffer = Buffer.alloc(0), extra: Record<string, string> = {}, timeoutMs = 6000): Promise<Exchange> {
  const { endpoint, bucket, region, accessKeyId, secretAccessKey, pathStyle } = config.s3;
  const base = new URL(endpoint);
  const host = pathStyle ? base.host : `${bucket}.${base.host}`;
  const path = pathStyle ? `/${bucket}${key ? `/${key}` : ""}` : `/${key}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...Object.fromEntries(Object.entries(extra).map(([name, value]) => [name.toLowerCase(), value])),
  };
  const names = Object.keys(headers).sort();
  const canonical = [
    method,
    encodePath(path),
    "",
    names.map((name) => `${name}:${headers[name]!.trim()}\n`).join(""),
    names.join(";"),
    payloadHash,
  ].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonical)].join("\n");
  let signingKey = hmac(`AWS4${secretAccessKey}`, day);
  for (const part of [region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  const { host: _host, ...sendable } = headers;
  try {
    const response = await fetch(`${base.protocol}//${host}${encodePath(path)}`, {
      method,
      headers: sendable,
      body: method === "PUT" ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: response.status, body: Buffer.from(await response.arrayBuffer()), headers: response.headers };
  } catch {
    throw new StoreUnavailable();
  }
}

export async function ensureBucket(): Promise<void> {
  const head = await send("HEAD", "");
  if (head.status === 200) return;
  if (head.status !== 404) throw new StoreUnavailable();
  const made = await send("PUT", "");
  if (made.status !== 200 && made.status !== 409) throw new StoreUnavailable();
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await send("PUT", key, body, { "content-type": contentType, "x-amz-meta-sha256": sha256Hex(body) }, 15000);
  if (response.status !== 200) throw new StoreUnavailable();
}

interface StoredObject {
  body: Buffer;
  contentType: string;
}

/** The object's bytes, or null when the key is missing. */
export async function getObject(key: string): Promise<StoredObject | null> {
  const response = await send("GET", key, Buffer.alloc(0), {}, 15000);
  if (response.status === 404) return null;
  if (response.status !== 200) throw new StoreUnavailable();
  return { body: response.body, contentType: response.headers.get("content-type") ?? "application/octet-stream" };
}

export { sha256Hex };
