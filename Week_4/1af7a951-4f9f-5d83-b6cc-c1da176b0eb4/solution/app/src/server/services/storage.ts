import { createHash, createHmac } from "node:crypto";
import { config } from "../config.js";
import { fail } from "../http.js";

// Voice memos in MinIO through the S3 API, signed with AWS Signature Version 4.

const TIMEOUT_MS = 10_000;
const { endpoint, region, bucket, forcePathStyle, accessKeyId, secretAccessKey } = config.storage;

export function memoKey(enrollmentId: string, entryId: string): string {
  return `memos/${enrollmentId}/${entryId}`;
}

const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string): Buffer => createHmac("sha256", key).update(data).digest();
const encodePath = (path: string): string =>
  path
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");

function objectUrl(key: string): URL {
  const base = new URL(endpoint);
  if (forcePathStyle) return new URL(`${base.origin}${encodePath(`/${bucket}/${key}`)}`);
  return new URL(`${base.protocol}//${bucket}.${base.host}${encodePath(`/${key}`)}`);
}

async function signedRequest(method: "GET" | "PUT", key: string, body?: Buffer, extra: Record<string, string> = {}): Promise<Response> {
  const url = objectUrl(key);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": sha256(body ?? ""),
    "x-amz-date": amzDate,
    ...Object.fromEntries(Object.entries(extra).map(([name, value]) => [name.toLowerCase(), value])),
  };
  const names = Object.keys(headers).sort();
  const canonical = [method, url.pathname, "", names.map((name) => `${name}:${headers[name]?.trim()}\n`).join(""), names.join(";"), headers["x-amz-content-sha256"]].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonical)}`;
  const signingKey = ["s3", "aws4_request"].reduce<Buffer>((key, part) => hmac(key, part), hmac(hmac(`AWS4${secretAccessKey}`, day), region));
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const { host: _host, ...sent } = headers;
  try {
    return await fetch(url, {
      method,
      headers: { ...sent, Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw fail(503, "memo_storage_unavailable");
  }
}

function checked(response: Response): Response {
  if (response.status >= 500) throw fail(503, "memo_storage_unavailable");
  if (!response.ok) throw new Error(`object storage answered ${response.status}`);
  return response;
}

/** Stores the memo bytes exactly as uploaded, with the submitted type and the duration as user metadata. */
export async function putMemo(key: string, data: Buffer, contentType: string, durationMs: number): Promise<void> {
  checked(await signedRequest("PUT", key, data, { "Content-Type": contentType, "x-amz-meta-duration-ms": String(durationMs) }));
}

export async function getMemo(key: string): Promise<Buffer> {
  const response = checked(await signedRequest("GET", key));
  return Buffer.from(await response.arrayBuffer());
}
