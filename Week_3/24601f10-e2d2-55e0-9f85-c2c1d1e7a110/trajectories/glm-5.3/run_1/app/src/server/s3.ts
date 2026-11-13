import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";

const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

export interface S3Client {
  put(key: string, body: Buffer, contentType: string): Promise<string>;
  get(key: string): Promise<{ body: Buffer | null; contentType: string | null }>;
  ping(): Promise<boolean>;
}

interface AwsSigParts {
  host: string;
  path: string;
}

function splitEndpoint(): AwsSigParts {
  const url = new URL(config.s3.endpoint);
  const host = url.host;
  const path = url.pathname.replace(/\/+$/, "");
  return { host, path };
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

export class S3Error extends Error {}

async function signedFetch(method: "GET" | "PUT" | "HEAD", key: string, body?: Buffer, contentType?: string): Promise<Response> {
  const { host, path } = splitEndpoint();
  const isPathStyle = config.s3.forcePathStyle;
  const virtualHost = isPathStyle ? host : `${config.s3.bucket}.${host}`;
  const url = `${config.s3.endpoint.replace(/\/+$/, "")}${isPathStyle ? `/${config.s3.bucket}` : ""}/${key}`;
  const canonicalUri = `${isPathStyle ? `${path}/${config.s3.bucket}` : path}/${key}`
    .replace(/\/+/g, "/")
    .split("/")
    .map((p, i) => (i === 0 || p === "" ? p : encodeURIComponent(p)))
    .join("/");

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = body ? sha256hex(body) : sha256hex("");
  const headers: Record<string, string> = {
    host: isPathStyle ? host : virtualHost,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (body) headers["content-length"] = String(body.length);
  if (contentType) headers["content-type"] = contentType;

  const headerNames = Object.keys(headers).sort();
  const canonicalHeaders = headerNames.map((h) => `${h}:${headers[h].trim()}\n`).join("");
  const signedHeaders = headerNames.join(";");
  const canonicalRequest = [
    method,
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash === UNSIGNED_PAYLOAD ? UNSIGNED_PAYLOAD : payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, dateStamp), config.s3.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  const auth = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetchWithTimeout(url, {
    method,
    headers: { ...headers, Authorization: auth },
    body: body !== undefined ? body : undefined,
  }, 5000);
}

export const s3: S3Client = {
  async put(key, body, contentType) {
    const res = await signedFetch("PUT", key, body, contentType);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new S3Error(`S3 put ${key} failed: ${res.status} ${text}`);
    }
    return res.headers.get("etag") ?? "";
  },

  async get(key) {
    const res = await signedFetch("GET", key);
    if (res.status === 404) return { body: null, contentType: null };
    if (!res.ok) throw new S3Error(`S3 get ${key} failed: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return { body: buf, contentType: res.headers.get("content-type") };
  },

  async ping() {
    try {
      const res = await signedFetch("HEAD", "healthcheck.txt");
      return res.status === 200 || res.status === 404;
    } catch {
      return false;
    }
  },
};

export async function ensureBucket(): Promise<void> {
  const { host, path } = splitEndpoint();
  const isPathStyle = config.s3.forcePathStyle;
  const url = `${config.s3.endpoint.replace(/\/+$/, "")}${isPathStyle ? `/${config.s3.bucket}` : ""}/`;
  const method = "PUT";
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex("");
  const headers: Record<string, string> = {
    host: isPathStyle ? host : `${config.s3.bucket}.${host}`,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const headerNames = Object.keys(headers).sort();
  const canonicalHeaders = headerNames.map((h) => `${h}:${headers[h].trim()}\n`).join("");
  const signedHeaders = headerNames.join(";");
  const canonicalUri = isPathStyle ? `${path}/${config.s3.bucket}/` : "/";
  const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${dateStamp}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, dateStamp), config.s3.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
  const auth = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const res = await fetchWithTimeout(url, { method, headers: { ...headers, Authorization: auth } }, 5000);
  // 200 created, or 409 BucketAlreadyOwnedByYou: both fine.
  if (!res.ok && res.status !== 409) {
    const text = await res.text().catch(() => "");
    throw new S3Error(`ensure bucket failed: ${res.status} ${text}`);
  }
}
