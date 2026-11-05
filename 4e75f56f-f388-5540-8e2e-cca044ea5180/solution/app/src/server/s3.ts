import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";
import { ApiError } from "./http.js";

export const LINK_SECONDS = 60;
const EMPTY_SHA = createHash("sha256").update("").digest("hex");

function unavailable(): ApiError {
  return new ApiError(503, "storage_unavailable", "Storage is unavailable right now.");
}

function encodePath(path: string): string {
  return path
    .split("/")
    .map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

function target(key: string): { url: URL; canonicalPath: string } {
  const endpoint = new URL(config.s3.endpoint);
  const objectPath = key ? `/${encodePath(key)}` : "";
  if (config.s3.forcePathStyle) {
    const canonicalPath = `/${config.s3.bucket}${objectPath}`;
    return { url: new URL(`${endpoint.origin}${canonicalPath}`), canonicalPath };
  }
  const canonicalPath = objectPath || "/";
  return { url: new URL(`${endpoint.protocol}//${config.s3.bucket}.${endpoint.host}${canonicalPath}`), canonicalPath };
}

function stamp(now: Date): { amzDate: string; day: string } {
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return { amzDate, day: amzDate.slice(0, 8) };
}

function signingKey(day: string): Buffer {
  let key: Buffer = createHmac("sha256", `AWS4${config.s3.secretAccessKey}`).update(day).digest();
  for (const part of [config.s3.region, "s3", "aws4_request"]) key = createHmac("sha256", key).update(part).digest();
  return key;
}

function sign(day: string, amzDate: string, canonical: string): string {
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${createHash("sha256").update(canonical).digest("hex")}`;
  return createHmac("sha256", signingKey(day)).update(toSign).digest("hex");
}

async function send(method: string, key: string, body?: { bytes: Buffer; contentType: string }): Promise<Response> {
  const { url, canonicalPath } = target(key);
  const { amzDate, day } = stamp(new Date());
  const payloadHash = body ? createHash("sha256").update(body.bytes).digest("hex") : EMPTY_SHA;
  const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (body) headers["content-type"] = body.contentType;
  const names = Object.keys(headers).sort();
  const canonical = [method, canonicalPath, "", names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const credential = `${config.s3.accessKeyId}/${day}/${config.s3.region}/s3/aws4_request`;
  const authorization = `AWS4-HMAC-SHA256 Credential=${credential}, SignedHeaders=${names.join(";")}, Signature=${sign(day, amzDate, canonical)}`;
  const { host: _host, ...sent } = headers;
  try {
    return await fetch(url, {
      method,
      headers: { ...sent, Authorization: authorization },
      body: body ? new Uint8Array(body.bytes) : null,
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw unavailable();
  }
}

let bucketReady = false;

async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  const head = await send("HEAD", "");
  if (head.status === 404) {
    const created = await send("PUT", "");
    if (!created.ok && created.status !== 409) throw unavailable();
  } else if (!head.ok) {
    throw unavailable();
  }
  bucketReady = true;
}

export async function putObject(key: string, bytes: Buffer, contentType: string): Promise<void> {
  await ensureBucket();
  const response = await send("PUT", key, { bytes, contentType });
  if (!response.ok) throw unavailable();
}

export async function deleteObject(key: string): Promise<void> {
  const response = await send("DELETE", key);
  if (!response.ok && response.status !== 404) throw unavailable();
}

export async function objectExists(key: string): Promise<boolean> {
  const response = await send("HEAD", key);
  if (response.status === 404) return false;
  if (!response.ok) throw unavailable();
  return true;
}

/** A presigned GET link valid for 60 seconds. */
export function signedLink(key: string): string {
  const { url, canonicalPath } = target(key);
  const { amzDate, day } = stamp(new Date());
  const query = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.s3.accessKeyId}/${day}/${config.s3.region}/s3/aws4_request`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(LINK_SECONDS),
    "X-Amz-SignedHeaders": "host",
  });
  query.sort();
  const canonicalQuery = query.toString().replace(/\+/g, "%20");
  const canonical = ["GET", canonicalPath, canonicalQuery, `host:${url.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  return `${url.origin}${url.pathname}?${canonicalQuery}&X-Amz-Signature=${sign(day, amzDate, canonical)}`;
}

