import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";
import { ProviderDown } from "./errors.js";

const s3 = config.s3;
const endpoint = new URL(s3.endpoint);

const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();

function encodePath(key: string): string {
  return key.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function target(key: string): { host: string; path: string } {
  return s3.forcePathStyle
    ? { host: endpoint.host, path: `/${s3.bucket}/${encodePath(key)}` }
    : { host: `${s3.bucket}.${endpoint.host}`, path: `/${encodePath(key)}` };
}

function signingKey(day: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${s3.secretAccessKey}`, day), s3.region), "s3"), "aws4_request");
}

function stamp(now: Date): { amzDate: string; day: string } {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate, day: amzDate.slice(0, 8) };
}

function canonicalQuery(query: Record<string, string>): string {
  return Object.keys(query)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(query[key] ?? "")}`)
    .join("&");
}

async function request(method: "PUT" | "HEAD", key: string, body: Buffer = Buffer.alloc(0), contentType?: string): Promise<Response> {
  const { host, path } = target(key);
  const { amzDate, day } = stamp(new Date());
  const payloadHash = sha256(body);
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [method, path, "", names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${s3.region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonical)}`;
  const signature = createHmac("sha256", signingKey(day)).update(toSign).digest("hex");
  const { host: _host, ...sent } = headers;
  const init: RequestInit = {
    method,
    headers: { ...sent, Authorization: `AWS4-HMAC-SHA256 Credential=${s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` },
    signal: AbortSignal.timeout(15000),
  };
  if (method === "PUT") init.body = body;
  try {
    return await fetch(`${endpoint.protocol}//${host}${path}`, init);
  } catch (error) {
    throw new ProviderDown("minio", error instanceof Error ? error.message : String(error));
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await request("PUT", key, body, contentType);
  if (response.status >= 500) throw new ProviderDown("minio", `PUT HTTP ${response.status}`);
  if (!response.ok) throw new Error(`MinIO PUT ${key}: HTTP ${response.status}`);
}

/** Confirms MinIO answers for this object before a link is issued. */
export async function objectExists(key: string): Promise<boolean> {
  const response = await request("HEAD", key);
  if (response.status >= 500) throw new ProviderDown("minio", `HEAD HTTP ${response.status}`);
  return response.ok;
}

/** A presigned GET URL on S3_ENDPOINT, valid for `seconds`. */
export function presign(key: string, seconds: number): { url: string; expiresAt: Date } {
  const now = new Date();
  const { host, path } = target(key);
  const { amzDate, day } = stamp(now);
  const scope = `${day}/${s3.region}/s3/aws4_request`;
  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${s3.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(seconds),
    "X-Amz-SignedHeaders": "host",
  };
  const qs = canonicalQuery(query);
  const canonical = ["GET", path, qs, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonical)}`;
  const signature = createHmac("sha256", signingKey(day)).update(toSign).digest("hex");
  return {
    url: `${endpoint.protocol}//${host}${path}?${qs}&X-Amz-Signature=${signature}`,
    expiresAt: new Date(now.getTime() + seconds * 1000),
  };
}

export async function reachable(): Promise<boolean> {
  try {
    const response = await fetch(`${s3.endpoint}/minio/health/ready`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}
