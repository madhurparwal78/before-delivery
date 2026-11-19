// Object storage over the S3 API with AWS Signature Version 4; each call gives up after 10 seconds.
import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";

const CALL_TIMEOUT_MS = 10_000;

export class StorageUnavailable extends Error {}

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

// Percent-encodes a path segment the way SigV4 canonical requests expect.
const encode = (segment: string) =>
  encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function target(key: string): { url: string; host: string; path: string } {
  const endpoint = new URL(config.s3.endpoint);
  const objectPath = key.split("/").map(encode).join("/");
  if (config.s3.forcePathStyle) {
    const path = `/${encode(config.s3.bucket)}/${objectPath}`;
    return { url: `${endpoint.origin}${path}`, host: endpoint.host, path };
  }
  const host = `${config.s3.bucket}.${endpoint.host}`;
  return { url: `${endpoint.protocol}//${host}/${objectPath}`, host, path: `/${objectPath}` };
}

async function call(method: "PUT" | "GET", key: string, body: Buffer | null, signal: AbortSignal, extra: Record<string, string> = {}): Promise<Response> {
  const { url, host, path } = target(key);
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = now.slice(0, 8);
  const payloadHash = sha256(body ?? "");
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": now, ...extra };
  const names = Object.keys(headers).sort();
  const canonical = [method, path, "", names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", now, scope, sha256(canonical)].join("\n");
  let signingKey = hmac(`AWS4${config.s3.secretAccessKey}`, day);
  for (const part of [config.s3.region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const { host: _host, ...sent } = headers;
  return fetch(url, {
    method,
    headers: {
      ...sent,
      authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
    },
    body,
    signal: AbortSignal.any([signal, AbortSignal.timeout(CALL_TIMEOUT_MS)]),
  });
}

export async function putObject(key: string, body: Buffer, contentType: string, signal: AbortSignal): Promise<void> {
  let response: Response;
  try {
    response = await call("PUT", key, body, signal, { "content-type": contentType });
  } catch (error) {
    throw new StorageUnavailable(String(error));
  }
  await response.arrayBuffer().catch(() => undefined);
  if (!response.ok) throw new StorageUnavailable(`PUT ${response.status}`);
}

// The stored bytes, or null when storage answers that the object does not exist.
export async function getObject(key: string, signal: AbortSignal): Promise<Buffer | null> {
  let response: Response;
  try {
    response = await call("GET", key, null, signal);
    if (response.status === 404) {
      await response.arrayBuffer().catch(() => undefined);
      return null;
    }
    if (!response.ok) throw new StorageUnavailable(`GET ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (error instanceof StorageUnavailable) throw error;
    throw new StorageUnavailable(String(error));
  }
}

export function objectKey(documentId: string, exportId: string): string {
  return `exports/${documentId}/${exportId}.csv`;
}

export const digest = (data: Buffer) => sha256(data);
