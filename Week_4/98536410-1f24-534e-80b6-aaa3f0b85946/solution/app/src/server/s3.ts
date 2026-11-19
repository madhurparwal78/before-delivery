// Minimal S3 client: AWS Signature Version 4 over fetch, for the few calls the app needs.
import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";

const REQUEST_TIMEOUT_MS = 4000;

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function encodeKey(key: string): string {
  return key.split("/").map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");
}

interface S3Answer {
  status: number;
  body: Buffer;
}

async function send(method: string, key: string | null, body: Buffer = Buffer.alloc(0), contentType?: string): Promise<S3Answer> {
  const { endpoint, bucket, region, forcePathStyle, accessKeyId, secretAccessKey } = config.s3;
  const base = new URL(endpoint);
  const host = forcePathStyle ? base.host : `${bucket}.${base.host}`;
  const path = forcePathStyle ? `/${bucket}${key ? `/${encodeKey(key)}` : ""}` : `/${key ? encodeKey(key) : ""}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers).sort().map((name) => `${name}:${headers[name]}\n`).join("");
  const canonicalRequest = [method, path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const requestHeaders: Record<string, string> = {
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (contentType) requestHeaders["content-type"] = contentType;
  const response = await fetch(`${base.protocol}//${host}${path}`, {
    method,
    headers: requestHeaders,
    body: method === "PUT" ? new Uint8Array(body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return { status: response.status, body: Buffer.from(await response.arrayBuffer()) };
}

/** True when the bucket answers; creates it first when it does not exist. */
export async function ensureBucket(): Promise<void> {
  const head = await send("HEAD", null);
  if (head.status === 200) return;
  if (head.status !== 404) throw new Error(`bucket check answered ${head.status}`);
  const created = await send("PUT", null);
  if (created.status !== 200 && created.status !== 409) throw new Error(`bucket creation answered ${created.status}`);
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const answer = await send("PUT", key, body, contentType);
  if (answer.status !== 200) throw new Error(`storing ${key} answered ${answer.status}`);
}

/** The stored bytes, or null when no such object exists. */
export async function getObject(key: string): Promise<Buffer | null> {
  const answer = await send("GET", key);
  if (answer.status === 404) return null;
  if (answer.status !== 200) throw new Error(`reading ${key} answered ${answer.status}`);
  return answer.body;
}

export async function deleteObject(key: string): Promise<void> {
  const answer = await send("DELETE", key);
  if (answer.status !== 204 && answer.status !== 200 && answer.status !== 404) throw new Error(`deleting ${key} answered ${answer.status}`);
}
