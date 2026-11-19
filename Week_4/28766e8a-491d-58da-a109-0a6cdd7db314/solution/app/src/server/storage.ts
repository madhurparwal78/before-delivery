// MinIO object storage over the S3 API with SigV4 signing (brief: Services, MinIO). Each call is
// a fresh request, so exports work again as soon as storage returns.
import { createHash, createHmac } from "node:crypto";
import { config } from "./config";

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function encodePath(path: string): string {
  return path.split("/").map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");
}

function objectUrl(key: string): URL {
  const base = new URL(config.s3.endpoint);
  if (config.s3.forcePathStyle) return new URL(`${base.origin}${base.pathname.replace(/\/$/, "")}/${config.s3.bucket}/${encodePath(key)}`);
  return new URL(`${base.protocol}//${config.s3.bucket}.${base.host}/${encodePath(key)}`);
}

function signedHeaders(method: string, url: URL, payload: Buffer, extra: Record<string, string>): Record<string, string> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(payload);
  const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate, ...extra };
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const canonicalHeaders = names.map((n) => `${n}:${String(headers[n]).trim()}\n`).join("");
  const canonical = [method, url.pathname, "", canonicalHeaders, names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  let key: Buffer = hmac(`AWS4${config.s3.secretAccessKey}`, day);
  for (const part of [config.s3.region, "s3", "aws4_request"]) key = hmac(key, part);
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  const { host: _host, ...rest } = headers;
  return { ...rest, Authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` };
}

async function request(method: string, key: string, payload: Buffer, extra: Record<string, string>, timeoutMs: number): Promise<Response> {
  const url = objectUrl(key);
  return fetch(url, { method, headers: signedHeaders(method, url, payload, extra), body: method === "PUT" ? new Uint8Array(payload) : null, signal: AbortSignal.timeout(timeoutMs) });
}

export async function putObject(key: string, body: Buffer, contentType: string, timeoutMs: number): Promise<void> {
  const res = await request("PUT", key, body, { "content-type": contentType }, timeoutMs);
  if (!res.ok) throw new Error(`storage PUT ${res.status}`);
}

/** True only when storage confirms the object exists. */
export async function objectExists(key: string, timeoutMs: number): Promise<boolean> {
  const res = await request("HEAD", key, Buffer.alloc(0), {}, timeoutMs);
  return res.ok;
}

export async function getObject(key: string): Promise<{ body: Buffer; contentType: string }> {
  const res = await request("GET", key, Buffer.alloc(0), {}, 10000);
  if (!res.ok) throw new Error(`storage GET ${res.status}`);
  return { body: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "application/octet-stream" };
}
