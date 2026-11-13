/**
 * Private certificate files in MinIO, spoken to over S3 with AWS Signature Version 4.
 * The bucket stays private: no policy or ACL is ever set; coordinators get 60-second signed links.
 */
import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";
import { storageUnavailable } from "./errors.js";

const TIMEOUT_MS = 10_000;
export const LINK_SECONDS = 60;

const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();

const encode = (value: string): string =>
  encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function objectUrl(key: string): URL {
  const endpoint = new URL(config.storage.endpoint);
  const path = key.split("/").map(encode).join("/");
  if (config.storage.forcePathStyle) return new URL(`${endpoint.origin}/${encode(config.storage.bucket)}/${path}`);
  return new URL(`${endpoint.protocol}//${config.storage.bucket}.${endpoint.host}/${path}`);
}

function stamp(now: Date): { amzDate: string; day: string } {
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return { amzDate, day: amzDate.slice(0, 8) };
}

function signature(day: string, stringToSign: string): string {
  let key = hmac(`AWS4${config.storage.secretAccessKey}`, day);
  for (const part of [config.storage.region, "s3", "aws4_request"]) key = hmac(key, part);
  return createHmac("sha256", key).update(stringToSign).digest("hex");
}

function canonicalQuery(params: URLSearchParams): string {
  return [...params.entries()]
    .map(([k, v]) => [encode(k), encode(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

async function signedRequest(method: "PUT" | "HEAD", key: string, body?: Buffer, contentType?: string): Promise<Response> {
  const url = objectUrl(key);
  const { amzDate, day } = stamp(new Date());
  const payloadHash = sha256(body ?? "");
  const scope = `${day}/${config.storage.region}/s3/aws4_request`;
  const signed: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const names = Object.keys(signed).sort();
  const canonical = [
    method,
    url.pathname,
    "",
    names.map((n) => `${n}:${signed[n]}\n`).join(""),
    names.join(";"),
    payloadHash,
  ].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const headers: Record<string, string> = {
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    Authorization: `AWS4-HMAC-SHA256 Credential=${config.storage.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature(day, stringToSign)}`,
  };
  if (contentType) headers["Content-Type"] = contentType;
  try {
    return await fetch(url, { method, headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw storageUnavailable();
  }
}

/** Stores a file; storage_unavailable when MinIO cannot be reached or refuses it. */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await signedRequest("PUT", key, body, contentType);
  if (!response.ok) throw storageUnavailable();
}

/**
 * A signed GET link valid for 60 seconds, after confirming storage answers for the file
 * (the link is only handed out when the file can actually be opened).
 */
export async function fileLink(key: string): Promise<string> {
  const head = await signedRequest("HEAD", key);
  if (!head.ok) throw storageUnavailable();
  const url = objectUrl(key);
  const { amzDate, day } = stamp(new Date());
  const scope = `${day}/${config.storage.region}/s3/aws4_request`;
  const query = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.storage.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(LINK_SECONDS),
    "X-Amz-SignedHeaders": "host",
  });
  const canonical = ["GET", url.pathname, canonicalQuery(query), `host:${url.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  return `${url.origin}${url.pathname}?${canonicalQuery(query)}&X-Amz-Signature=${signature(day, stringToSign)}`;
}
