// Evidence storage in the S3-compatible object store, signed with AWS Signature Version 4.
// Every failure to reach or be confirmed by the store surfaces as StorageUnavailable.

import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";

export class StorageUnavailable extends Error {}

const REQUEST_TIMEOUT_MS = 2500;

const sha256Hex = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

function objectUrl(key: string): URL {
  const endpoint = new URL(config.s3.endpoint);
  const path = key.split("/").map(encodeURIComponent).join("/");
  if (config.s3.forcePathStyle) return new URL(`${endpoint.origin}/${config.s3.bucket}${key ? `/${path}` : ""}`);
  return new URL(`${endpoint.protocol}//${config.s3.bucket}.${endpoint.host}/${path}`);
}

async function signedRequest(method: string, key: string, body: Buffer = Buffer.alloc(0),
  extraHeaders: Record<string, string> = {}): Promise<Response> {
  const url = objectUrl(key);
  const amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    host: url.host, "x-amz-content-sha256": sha256Hex(body), "x-amz-date": amzDate,
    ...Object.fromEntries(Object.entries(extraHeaders).map(([k, v]) => [k.toLowerCase(), v])),
  };
  const names = Object.keys(headers).sort();
  const canonical = [method, url.pathname, "", ...names.map((n) => `${n}:${headers[n]!.trim()}`), "",
    names.join(";"), headers["x-amz-content-sha256"]].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonical)].join("\n");
  let signingKey = hmac(`AWS4${config.s3.secretAccessKey}`, day);
  for (const part of [config.s3.region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const { host: _host, ...sent } = headers;
  try {
    return await fetch(url, {
      method,
      headers: { ...sent, authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` },
      body: method === "PUT" ? body : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new StorageUnavailable();
  }
}

async function expectOk(response: Response): Promise<Response> {
  if (!response.ok) {
    await response.arrayBuffer();
    throw new StorageUnavailable();
  }
  return response;
}

let bucketReady = false;

/** Creates the bucket when it is missing (once per process, retried while the store is unreachable). */
export async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  const head = await signedRequest("HEAD", "");
  if (head.status === 404) await expectOk(await signedRequest("PUT", ""));
  else await expectOk(head);
  bucketReady = true;
}

/** Writes an object with its content type and `sha256` user metadata. */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await ensureBucket();
  await expectOk(await signedRequest("PUT", key, body, {
    "content-type": contentType, "x-amz-meta-sha256": sha256Hex(body),
  }));
}

/** Reads back an object's metadata: its size and `sha256` user metadata. */
export async function headObject(key: string): Promise<{ size: number; sha256: string | null }> {
  const response = await expectOk(await signedRequest("HEAD", key));
  return { size: Number(response.headers.get("content-length")), sha256: response.headers.get("x-amz-meta-sha256") };
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await expectOk(await signedRequest("GET", key));
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  await expectOk(await signedRequest("DELETE", key));
}
