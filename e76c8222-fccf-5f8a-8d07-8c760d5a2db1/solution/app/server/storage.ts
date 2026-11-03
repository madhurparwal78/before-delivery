// MinIO / S3: private objects, SigV4-signed, served only through the app.
import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";
import { ApiError } from "./errors.js";

const TIMEOUT_MS = 4000;
/** The status endpoint probes each dependency within 2 s. */
const PROBE_TIMEOUT_MS = 2000;
const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string): Buffer => createHmac("sha256", key).update(data).digest();

/** RFC 3986 encoding of each key segment, keeping the slashes. */
const encodeKey = (key: string): string =>
  key
    .split("/")
    .map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");

function target(key: string): { url: URL; path: string } {
  const base = new URL(config.s3.endpoint);
  const objectPath = key ? `/${encodeKey(key)}` : "/";
  if (config.s3.forcePathStyle) {
    const path = `/${config.s3.bucket}${key ? objectPath : ""}`;
    return { url: new URL(path, base), path };
  }
  base.hostname = `${config.s3.bucket}.${base.hostname}`;
  return { url: new URL(objectPath, base), path: objectPath };
}

async function send(method: string, key: string, body?: Buffer, contentType?: string, timeoutMs = TIMEOUT_MS): Promise<Response> {
  const { url, path } = target(key);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body ?? "");
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [
    method,
    path,
    "",
    names.map((n) => `${n}:${headers[n]}\n`).join(""),
    names.join(";"),
    payloadHash,
  ].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonical)}`;
  let signingKey = hmac(`AWS4${config.s3.secretAccessKey}`, day);
  for (const part of [config.s3.region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const { host: _host, ...sent } = headers;
  try {
    return await fetch(url, {
      method,
      headers: {
        ...sent,
        authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
      },
      body: body ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ApiError("storage_unavailable");
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await send("PUT", key, body, contentType);
  await response.arrayBuffer();
  if (!response.ok) throw new ApiError("storage_unavailable");
}

/** The object's bytes, or null when it does not exist. */
export async function getObject(key: string): Promise<Buffer | null> {
  const response = await send("GET", key);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (response.status === 404) return null;
  if (!response.ok) throw new ApiError("storage_unavailable");
  return bytes;
}

export async function deleteObject(key: string): Promise<void> {
  const response = await send("DELETE", key);
  await response.arrayBuffer();
}

export async function storageReachable(): Promise<boolean> {
  try {
    const response = await send("HEAD", "", undefined, undefined, PROBE_TIMEOUT_MS);
    await response.arrayBuffer();
    return response.status < 500;
  } catch {
    return false;
  }
}
