import * as crypto from "node:crypto";
import { config } from "../config.js";

export interface MinIOState {
  available: boolean;
  lastCheck: number;
}

export const minioState: MinIOState = { available: false, lastCheck: 0 };

const encoder = new TextEncoder();

function hmac(key: crypto.BinaryLike, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(encoder.encode(data)).digest();
}

function sha256Hex(data: crypto.BinaryLike): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function signedFetch(
  method: string,
  url: string,
  body?: Uint8Array | null,
  contentType?: string,
  timeoutMs = 30_000,
): Promise<Response> {
  const target = new URL(url);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body ?? new Uint8Array(0));
  const headers: Record<string, string> = {
    host: target.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (contentType) headers["content-type"] = contentType;
  const signedHeadersList = Object.keys(headers)
    .map((h) => h.toLowerCase())
    .sort()
    .join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((h) => `${h.toLowerCase()}:${String(headers[h]).trim()}\n`)
    .join("");
  const canonicalRequest = [
    method,
    target.pathname,
    "",
    canonicalHeaders,
    signedHeadersList,
    payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, dateStamp), config.s3.region), "s3"),
    "aws4_request",
  );
  const signature = crypto.createHmac("sha256", signingKey).update(encoder.encode(stringToSign)).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeadersList}, Signature=${signature}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method,
      headers: { authorization, ...headers },
      body: body ? (body as unknown as BodyInit) : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function probe(): Promise<void> {
  try {
    const res = await signedFetch("HEAD", `${config.s3.endpoint}/${config.s3.bucket}`, undefined, undefined, 3000);
    minioState.available = res.ok || res.status === 403 || res.status === 404;
  } catch {
    minioState.available = false;
  }
  minioState.lastCheck = Date.now();
}

export async function ensureBucket(): Promise<void> {
  try {
    const res = await signedFetch("PUT", `${config.s3.endpoint}/${config.s3.bucket}`, undefined, undefined, 5000);
    minioState.available = res.ok || res.status === 409;
  } catch {
    minioState.available = false;
  }
  minioState.lastCheck = Date.now();
}

export async function minioAvailable(): Promise<boolean> {
  if (Date.now() - minioState.lastCheck < 5000) return minioState.available;
  await probe();
  return minioState.available;
}

/** Store bytes; confirmed only by a HEAD that reports the exact size. */
export async function putObject(key: string, bytes: Uint8Array, contentType: string): Promise<boolean> {
  try {
    const res = await signedFetch("PUT", `${config.s3.endpoint}/${config.s3.bucket}/${key}`, bytes, contentType);
    if (!res.ok) {
      minioState.available = false;
      minioState.lastCheck = Date.now();
      return false;
    }
    const size = await headObject(key);
    minioState.available = true;
    minioState.lastCheck = Date.now();
    return size === bytes.length;
  } catch {
    minioState.available = false;
    minioState.lastCheck = Date.now();
    return false;
  }
}

export async function headObject(key: string): Promise<number | null> {
  try {
    const res = await signedFetch("HEAD", `${config.s3.endpoint}/${config.s3.bucket}/${key}`);
    if (!res.ok) return null;
    return Number(res.headers.get("content-length") ?? -1);
  } catch {
    return null;
  }
}

export async function getObject(key: string): Promise<Uint8Array | null> {
  try {
    const res = await signedFetch("GET", `${config.s3.endpoint}/${config.s3.bucket}/${key}`);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export async function objectExists(key: string): Promise<boolean> {
  return (await headObject(key)) !== null;
}
