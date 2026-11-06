// MinIO through the S3 API (brief: Services › MinIO), signed with AWS Signature V4. Objects are
// written once, whole, with a single PUT after the upload body is complete, so a refused or cut-off
// upload never starts a storage write and no multipart upload can be left behind.
import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";
import { ProviderDown } from "./errors.js";

const { endpoint, region, bucket, forcePathStyle, accessKeyId, secretAccessKey } = config.s3;
const base = new URL(endpoint);

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

function target(key: string | null): { url: string; host: string; path: string } {
  const objectPath = key === null ? "" : `/${key}`;
  if (forcePathStyle) {
    const path = encodePath(`/${bucket}${objectPath}`) || "/";
    return { url: `${base.origin}${path}`, host: base.host, path };
  }
  const host = `${bucket}.${base.host}`;
  const path = encodePath(objectPath || "/");
  return { url: `${base.protocol}//${host}${path}`, host, path };
}

async function signedRequest(
  method: "GET" | "PUT" | "HEAD",
  key: string | null,
  timeoutMs: number,
  body?: Buffer,
  contentType?: string,
): Promise<Response> {
  const { url, host, path } = target(key);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body ?? "");
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [method, path, "", names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256Hex(canonical)}`;
  let signingKey = hmac(`AWS4${secretAccessKey}`, day);
  for (const part of [region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const { host: _host, ...sent } = headers;
  try {
    return await fetch(url, {
      method,
      headers: {
        ...sent,
        authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
      },
      ...(body ? { body } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ProviderDown("storage unreachable");
  }
}

/** Writes the object exactly as given; resolves only once storage has confirmed the write. */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await signedRequest("PUT", key, 30_000, body, contentType);
  await response.arrayBuffer();
  if (!response.ok) throw new ProviderDown(`storage refused the write (${response.status})`);
}

/** The stored bytes of an object. */
export async function getObject(key: string): Promise<Buffer> {
  const response = await signedRequest("GET", key, 30_000);
  const data = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new ProviderDown(`storage refused the read (${response.status})`);
  return data;
}

/** True when the bucket answers within the probe timeout. */
export async function bucketAnswers(timeoutMs: number): Promise<boolean> {
  try {
    const response = await signedRequest("HEAD", null, timeoutMs);
    return response.ok;
  } catch {
    return false;
  }
}

export function reportKey(carId: string, reportId: string): string {
  return `cars/${carId}/condition-reports/${reportId}.pdf`;
}

export function photoKey(carId: string, photoId: string, contentType: string): string {
  return `cars/${carId}/photos/${photoId}.${contentType === "image/png" ? "png" : "jpg"}`;
}
