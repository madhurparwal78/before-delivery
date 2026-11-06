import { createHmac, createHash } from "node:crypto";
import { config } from "../config";

// Minimal S3 client with AWS SigV4 (path-style). Private bucket only; photos reach
// browsers solely through the app's photo endpoint.

export class StorageUnavailable extends Error {}

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function s3Url(key: string): string {
  return `${config.s3Endpoint}/${config.s3Bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

async function s3Fetch(method: string, key: string, body: Buffer | null, headers: Record<string, string>, timeoutMs: number): Promise<Response> {
  const url = new URL(s3Url(key));
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = body === null ? sha256Hex("") : sha256Hex(body);
  const allHeaders: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
  };
  const signedHeaderNames = Object.keys(allHeaders).sort().join(";");
  const canonicalHeaders = Object.keys(allHeaders)
    .sort()
    .map((k) => `${k}:${allHeaders[k].trim()}\n`)
    .join("");
  const canonicalRequest = [method, url.pathname, "", canonicalHeaders, signedHeaderNames, payloadHash].join("\n");
  const scope = `${dateStamp}/${config.s3Region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.s3SecretAccessKey}`, dateStamp), config.s3Region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.s3AccessKeyId}/${scope}, SignedHeaders=${signedHeaderNames}, Signature=${signature}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method,
      headers: { ...allHeaders, authorization },
      body: body === null ? undefined : new Uint8Array(body),
      signal: controller.signal,
    } as RequestInit);
  } catch {
    throw new StorageUnavailable("Object storage unreachable");
  } finally {
    clearTimeout(timer);
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const res = await s3Fetch("PUT", key, body, { "content-type": contentType }, 10000);
  if (!res.ok) throw new StorageUnavailable(`Object storage put failed (${res.status})`);
}

export async function getObject(key: string): Promise<Buffer> {
  const res = await s3Fetch("GET", key, null, {}, 10000);
  if (res.status === 404) throw new StorageUnavailable("Object missing");
  if (!res.ok) throw new StorageUnavailable(`Object storage get failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const res = await s3Fetch("DELETE", key, null, {}, 10000);
  if (!res.ok && res.status !== 404) throw new StorageUnavailable(`Object storage delete failed (${res.status})`);
}

export async function headObjectOk(key: string): Promise<boolean> {
  const res = await s3Fetch("HEAD", key, null, {}, 10000);
  return res.ok;
}
