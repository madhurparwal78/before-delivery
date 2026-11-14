import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";
import { fail } from "./errors.js";

const OPERATION_TIMEOUT_MS = 10000;
const PROBE_TIMEOUT_MS = 2000;

function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

interface S3Request {
  method: "GET" | "PUT" | "HEAD";
  key?: string;
  body?: Uint8Array;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/** Sends one signed (AWS Signature Version 4) request; every call opens a fresh connection attempt. */
async function s3(request: S3Request): Promise<Response> {
  const { endpoint, region, bucket, forcePathStyle, accessKeyId, secretAccessKey } = config.s3;
  const base = new URL(endpoint);
  const keyPath = request.key ? `/${request.key.split("/").map(encodeSegment).join("/")}` : "/";
  const host = forcePathStyle ? base.host : `${bucket}.${base.host}`;
  const path = forcePathStyle ? `/${encodeSegment(bucket)}${request.key ? keyPath : ""}` : keyPath;
  const body = request.body ?? new Uint8Array();
  const now = new Date();
  const amzDate = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": sha256(body),
    ...Object.fromEntries(Object.entries(request.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]!.trim()}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [request.method, path, "", canonicalHeaders, signedHeaders, headers["x-amz-content-sha256"]].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  const sendHeaders = Object.fromEntries(Object.entries(headers).filter(([name]) => name !== "host"));
  return fetch(`${base.protocol}//${host}${path}`, {
    method: request.method,
    headers: {
      ...sendHeaders,
      authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body: request.method === "PUT" ? new Uint8Array(body) : undefined,
    signal: AbortSignal.timeout(request.timeoutMs ?? OPERATION_TIMEOUT_MS),
  });
}

let bucketReady = false;

async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  const head = await s3({ method: "HEAD" });
  if (head.status === 404) {
    const created = await s3({ method: "PUT" });
    if (!created.ok && created.status !== 409) throw new Error(`bucket create failed: ${created.status}`);
  } else if (!head.ok) throw new Error(`bucket check failed: ${head.status}`);
  bucketReady = true;
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    await ensureBucket();
    return await work();
  } catch (error) {
    bucketReady = false;
    console.error(`Storage request failed: ${(error as Error).message}`);
    throw fail.storage();
  }
}

export interface StoredObject {
  bytes: number;
  sha256: string;
}

/** Writes an object, then reads its metadata back and confirms size and SHA-256. */
export async function putVerified(key: string, body: Uint8Array): Promise<StoredObject> {
  const digest = sha256(body);
  return guarded(async () => {
    const put = await s3({
      method: "PUT",
      key,
      body,
      headers: { "content-type": "application/sql", "x-amz-meta-sha256": digest },
    });
    if (!put.ok) throw new Error(`put failed: ${put.status}`);
    const head = await s3({ method: "HEAD", key });
    if (!head.ok) throw new Error(`head failed: ${head.status}`);
    const size = Number(head.headers.get("content-length"));
    const storedDigest = head.headers.get("x-amz-meta-sha256");
    if (size !== body.length || storedDigest !== digest) throw new Error("stored object does not match");
    return { bytes: size, sha256: digest };
  });
}

export async function getObject(key: string): Promise<Buffer> {
  return guarded(async () => {
    const response = await s3({ method: "GET", key });
    if (!response.ok) throw new Error(`get failed: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  });
}

export async function probeStorage(): Promise<boolean> {
  try {
    const head = await s3({ method: "HEAD", timeoutMs: PROBE_TIMEOUT_MS });
    return head.ok || head.status === 404;
  } catch {
    return false;
  }
}
