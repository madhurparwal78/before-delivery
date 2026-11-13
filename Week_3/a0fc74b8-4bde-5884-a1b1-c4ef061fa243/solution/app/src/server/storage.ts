import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";
import { StorageError } from "./errors.js";

const REQUEST_TIMEOUT_MS = 5000;

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

async function signedRequest(method: string, key: string, body?: Buffer, contentType?: string): Promise<Response> {
  const { endpoint, region, bucket, forcePathStyle, accessKeyId, secretAccessKey } = config.s3;
  const base = new URL(endpoint);
  const host = forcePathStyle ? base.host : `${bucket}.${base.host}`;
  const objectPath = key ? `/${key}` : "";
  const path = encodePath(forcePathStyle ? `/${bucket}${objectPath}` : objectPath || "/") || "/";
  const payloadHash = createHash("sha256").update(body ?? "").digest("hex");
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [
    method,
    path,
    "",
    names.map((name) => `${name}:${headers[name]}\n`).join(""),
    names.join(";"),
    payloadHash,
  ].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  const requestHeaders = new Headers({ ...headers, authorization });
  requestHeaders.delete("host");
  const url = `${base.protocol}//${host}${path}`;
  try {
    return await fetch(url, {
      method,
      headers: requestHeaders,
      body: body ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new StorageError("object storage is unreachable");
  }
}

export async function putObject(key: string, body: Buffer): Promise<void> {
  const response = await signedRequest("PUT", key, body, "application/pdf");
  if (!response.ok) throw new StorageError(`PUT ${key} answered ${response.status}`);
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await signedRequest("GET", key);
  if (!response.ok) throw new StorageError(`GET ${key} answered ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function copyObject(fromKey: string, toKey: string): Promise<void> {
  await putObject(toKey, await getObject(fromKey));
}

export async function checkStorage(): Promise<boolean> {
  try {
    const response = await signedRequest("HEAD", "");
    return response.ok;
  } catch {
    return false;
  }
}

export async function ensureBucket(): Promise<void> {
  try {
    const head = await signedRequest("HEAD", "");
    if (head.status === 404) await signedRequest("PUT", "");
  } catch {
    /* storage may be down at start; the health check keeps trying */
  }
}

export const originalKey = (documentId: string) => `documents/${documentId}/original.pdf`;
export const completedKey = (documentId: string) => `documents/${documentId}/completed.pdf`;
export const templateOriginalKey = (templateId: string) => `templates/${templateId}/original.pdf`;
