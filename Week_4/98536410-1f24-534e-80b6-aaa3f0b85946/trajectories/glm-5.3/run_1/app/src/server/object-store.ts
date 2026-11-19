import * as crypto from "crypto";
import type { Config } from "./config.js";

export interface ObjectResult {
  body: Buffer;
  contentType: string;
}

export function bucketName(cfg: Config): string {
  return cfg.s3_bucket;
}

function endpointHost(cfg: Config): URL {
  const raw = cfg.s3_endpoint.replace(/\/+$/, "");
  return new URL(raw);
}

function signedPath(cfg: Config, key: string): string {
  const encoded = key.split("/").map((part) => encodeURIComponent(part)).join("/");
  if (cfg.s3_force_path_style) {
    return `/${cfg.s3_bucket}/${encoded}`;
  }
  return `/${encoded}`;
}

function hostForRequest(cfg: Config): { hostname: string; hostHeader: string; pathPrefix: string } {
  const url = endpointHost(cfg);
  const port = url.port ? `:${url.port}` : "";
  if (cfg.s3_force_path_style) {
    return { hostname: url.hostname, hostHeader: `${url.hostname}${port}`, pathPrefix: "" };
  }
  return { hostname: `${cfg.s3_bucket}.${url.hostname}`, hostHeader: `${cfg.s3_bucket}.${url.hostname}${port}`, pathPrefix: "" };
}

interface RequestParts {
  method: string;
  canonicalPath: string;
  headers: Record<string, string>;
  body: Buffer | null;
}

function canonicalHeaders(headers: Record<string, string>): { sorted: [string, string][]; signed: string; headerList: string } {
  const names = Object.keys(headers).sort();
  const lines = names.map((name) => `${name}:${headers[name].trim()}\n`);
  return { sorted: names.map((n) => [n, headers[n]] as [string, string]), signed: lines.join(""), headerList: names.join(";") };
}

function sha256Hex(data: Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data).digest();
}

export async function signedRequest(cfg: Config, parts: RequestParts): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  const url = endpointHost(cfg);
  const { hostname, hostHeader } = hostForRequest(cfg);
  const headers: Record<string, string> = { ...parts.headers };
  const payloadHash = sha256Hex(parts.body ?? Buffer.alloc(0));
  headers["x-amz-content-sha256"] = payloadHash;
  headers["x-amz-date"] = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  headers["host"] = hostHeader;
  if (!headers["content-type"]) headers["content-type"] = "application/octet-stream";
  const { signed, headerList } = canonicalHeaders(headers);
  const canonicalRequest = [parts.method, parts.canonicalPath, "", signed, headerList, payloadHash].join("\n");
  const scopeDate = headers["x-amz-date"].slice(0, 8);
  const scope = `${scopeDate}/${cfg.s3_region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", headers["x-amz-date"], scope, sha256Hex(Buffer.from(canonicalRequest, "utf8"))].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${cfg.s3_secret_access_key}`, scopeDate), cfg.s3_region), "s3"), "aws4_request");
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  headers["authorization"] = `AWS4-HMAC-SHA256 Credential=${cfg.s3_access_key_id}/${scope}, SignedHeaders=${headerList}, Signature=${signature}`;

  const scheme = url.protocol === "http:" ? "http:" : "https:";
  const portPart = url.port ? `:${url.port}` : "";
  const fullUrl = `${scheme}//${hostname}${portPart}${parts.canonicalPath}`;
  const init: RequestInit = {
    method: parts.method,
    headers,
    signal: AbortSignal.timeout(8000),
  };
  if (parts.body !== null) {
    init.body = new Uint8Array(parts.body);
  }
  const res = await fetch(fullUrl, init);
  const body = Buffer.from(await res.arrayBuffer());
  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((value, name) => {
    responseHeaders[name.toLowerCase()] = value;
  });
  return { status: res.status, headers: responseHeaders, body };
}

export async function createBucket(cfg: Config): Promise<void> {
  const res = await signedRequest(cfg, { method: "PUT", canonicalPath: `/${cfg.s3_bucket}`, headers: {}, body: Buffer.alloc(0) });
  if (res.status !== 200 && res.status !== 409) {
    throw new Error(`cannot create bucket: ${res.status}`);
  }
  await signedRequest(cfg, {
    method: "PUT",
    canonicalPath: `/${cfg.s3_bucket}?location`,
    headers: { "content-type": "application/xml" },
    body: Buffer.from("<CreateBucketConfiguration xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\"><LocationConstraint>us-east-1</LocationConstraint></CreateBucketConfiguration>", "utf8"),
  });
}

export async function headBucket(cfg: Config): Promise<boolean> {
  try {
    const res = await signedRequest(cfg, { method: "HEAD", canonicalPath: `/${cfg.s3_bucket}`, headers: {}, body: null });
    return res.status === 200;
  } catch {
    return false;
  }
}

export async function putObject(cfg: Config, key: string, contentType: string, body: Buffer): Promise<void> {
  const res = await signedRequest(cfg, { method: "PUT", canonicalPath: signedPath(cfg, key), headers: { "content-type": contentType }, body });
  if (res.status !== 200) throw new Error(`put object failed: ${res.status}`);
}

export async function deleteObject(cfg: Config, key: string): Promise<void> {
  const res = await signedRequest(cfg, { method: "DELETE", canonicalPath: signedPath(cfg, key), headers: {}, body: null });
  if (res.status !== 204 && res.status !== 200 && res.status !== 404) throw new Error(`delete object failed: ${res.status}`);
}

export async function getObject(cfg: Config, key: string): Promise<ObjectResult> {
  const res = await signedRequest(cfg, { method: "GET", canonicalPath: signedPath(cfg, key), headers: {}, body: null });
  if (res.status !== 200) throw new Error(`get object failed: ${res.status}`);
  return { body: res.body, contentType: res.headers["content-type"] ?? "application/octet-stream" };
}
