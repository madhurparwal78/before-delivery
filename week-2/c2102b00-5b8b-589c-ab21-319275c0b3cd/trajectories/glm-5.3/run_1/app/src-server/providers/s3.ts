import { createHash, createHmac } from "node:crypto";
import { config } from "../db";
import { PRODUCER_TIMEOUT_MS } from "../config";

export class S3Unavailable extends Error {
  constructor(override readonly cause: string) {
    super(`MinIO is unreachable: ${cause}`);
  }
}

export class S3Error extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

const SERVICE = "s3";

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function uriEncode(value: string, isPath = false): string {
  let out = "";
  for (const ch of encodeURIComponent(value)) {
    if (ch === "%") continue;
    out += ch;
  }
  // encodeURIComponent handles most; re-add characters it keeps but S3 encodes
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

interface S3Request {
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  key: string;
  contentType?: string;
  body?: Buffer;
  timeoutMs?: number;
}

async function s3Request(req: S3Request): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  const url = new URL(config.s3Endpoint);
  const host = url.hostname;
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  const canonicalUri = `/${config.s3Bucket}/${req.key}`.split("/").map((p, i) => (i === 0 ? p : uriEncode(p))).join("/");
  const payloadHash = sha256Hex(req.body ?? Buffer.alloc(0));
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    host: `${host}:${port}`,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (req.contentType) headers["content-type"] = req.contentType;
  const headerKeys = Object.keys(headers).sort();
  const canonicalHeaders = headerKeys.map((k) => `${k}:${headers[k]}\n`).join("");
  const signedHeaders = headerKeys.join(";");
  const canonicalRequest = [
    req.method,
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/${config.s3Region}/${SERVICE}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${config.s3SecretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, config.s3Region);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.s3AccessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? PRODUCER_TIMEOUT_MS);
  try {
    const res = await fetch(`${config.s3Endpoint}${canonicalUri}`, {
      method: req.method,
      headers: { ...headers, Authorization: authorization },
      body: req.body,
      signal: controller.signal,
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const outHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      outHeaders[k.toLowerCase()] = v;
    });
    return { status: res.status, headers: outHeaders, body: buf };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new S3Unavailable("timed out");
    }
    throw new S3Unavailable(e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const res = await s3Request({ method: "PUT", key, body, contentType });
  if (res.status !== 200) {
    throw new S3Error(res.status, "PutObject", `MinIO refused the upload: ${res.status}`);
  }
}

export interface StatResult {
  exists: boolean;
  bytes: number;
}

export async function statObject(key: string): Promise<StatResult> {
  const res = await s3Request({ method: "HEAD", key });
  if (res.status === 200) {
    return { exists: true, bytes: parseInt(res.headers["content-length"] ?? "0", 10) };
  }
  if (res.status === 404) return { exists: false, bytes: 0 };
  throw new S3Error(res.status, "HeadObject", `MinIO refused the check: ${res.status}`);
}

export async function getObject(key: string): Promise<Buffer | null> {
  const res = await s3Request({ method: "GET", key });
  if (res.status === 200) return res.body;
  if (res.status === 404) return null;
  throw new S3Error(res.status, "GetObject", `MinIO refused the read: ${res.status}`);
}

export async function deleteObject(key: string): Promise<void> {
  const res = await s3Request({ method: "DELETE", key });
  if (res.status !== 204 && res.status !== 200 && res.status !== 404) {
    throw new S3Error(res.status, "DeleteObject", `MinIO refused the delete: ${res.status}`);
  }
}
