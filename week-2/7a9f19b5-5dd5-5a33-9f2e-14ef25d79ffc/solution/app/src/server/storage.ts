// MinIO (S3) client with AWS Signature V4. The bucket is private; browsers only reach files through the app.
import { createHash, createHmac } from "node:crypto";
import { config, PROVIDER_TIMEOUT_MS } from "./config.js";
import { ProviderUnavailable } from "./errors.js";

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function target(key: string): URL {
  const endpoint = new URL(config.s3.endpoint);
  const path = key.split("/").map(encodeSegment).join("/");
  if (config.s3.forcePathStyle) return new URL(`${endpoint.origin}/${encodeSegment(config.s3.bucket)}/${path}`);
  return new URL(`${endpoint.protocol}//${config.s3.bucket}.${endpoint.host}/${path}`);
}

async function signedFetch(
  method: "GET" | "PUT" | "HEAD",
  key: string,
  body?: { data: Buffer; contentType: string },
  timeoutMs = PROVIDER_TIMEOUT_MS,
): Promise<Response> {
  const url = target(key);
  const now = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = now.slice(0, 8);
  const payloadHash = sha256(body?.data ?? "");
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": now,
    ...(body ? { "content-type": body.contentType } : {}),
  };
  const names = Object.keys(headers).sort();
  const canonical = [
    method,
    url.pathname,
    "",
    names.map((name) => `${name}:${headers[name]}\n`).join(""),
    names.join(";"),
    payloadHash,
  ].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${now}\n${scope}\n${sha256(canonical)}`;
  let signingKey = hmac(`AWS4${config.s3.secretAccessKey}`, day);
  for (const part of [config.s3.region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const { host: _host, ...sent } = headers;
  try {
    return await fetch(url, {
      method,
      headers: {
        ...sent,
        Authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
      },
      body: body ? new Uint8Array(body.data) : null,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ProviderUnavailable("minio", `${method} got no reply`);
  }
}

async function exists(key: string): Promise<boolean> {
  const response = await signedFetch("HEAD", key);
  if (response.status === 200) return true;
  if (response.status === 404) return false;
  throw new ProviderUnavailable("minio", `HEAD answered ${response.status}`);
}

/** Stores the object and confirms it exists before reporting success. */
export async function putConfirmed(key: string, data: Buffer, contentType: string): Promise<void> {
  const response = await signedFetch("PUT", key, { data, contentType });
  if (!response.ok) throw new ProviderUnavailable("minio", `PUT answered ${response.status}`);
  if (!(await exists(key))) throw new ProviderUnavailable("minio", "object missing after PUT");
}

/** The object's bytes and type, or null when there is no such object. */
export async function getObject(key: string): Promise<{ data: Buffer; contentType: string } | null> {
  const response = await signedFetch("GET", key);
  if (response.status === 404) return null;
  if (!response.ok) throw new ProviderUnavailable("minio", `GET answered ${response.status}`);
  try {
    return {
      data: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
    };
  } catch {
    throw new ProviderUnavailable("minio", "GET body was cut off");
  }
}

export async function healthy(timeoutMs: number): Promise<boolean> {
  try {
    const response = await signedFetch("HEAD", "lightfall-health-probe", undefined, timeoutMs);
    return response.status === 200 || response.status === 404;
  } catch {
    return false;
  }
}
