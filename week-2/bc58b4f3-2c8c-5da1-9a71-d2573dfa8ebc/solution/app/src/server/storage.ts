// Private object storage for signed verification forms: S3 requests to MinIO signed with AWS Signature V4.
import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";
import { ApiError } from "./http.js";

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function objectUrl(key: string): URL {
  const base = new URL(config.s3.endpoint);
  const path = key.split("/").map(encodeSegment).join("/");
  if (config.s3.forcePathStyle) return new URL(`${base.origin}/${encodeSegment(config.s3.bucket)}/${path}`);
  return new URL(`${base.protocol}//${config.s3.bucket}.${base.host}/${path}`);
}

function signedHeaders(method: string, url: URL, payloadHash: string, extra: Record<string, string>): Record<string, string> {
  const amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...extra,
  };
  const names = Object.keys(headers).sort();
  const canonical = [
    method,
    url.pathname,
    "",
    names.map((name) => `${name}:${(headers[name] ?? "").trim()}\n`).join(""),
    names.join(";"),
    payloadHash,
  ].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256Hex(canonical)}`;
  let key: Buffer = hmac(`AWS4${config.s3.secretAccessKey}`, day);
  for (const part of [config.s3.region, "s3", "aws4_request"]) key = hmac(key, part);
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  return {
    ...headers,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, ` +
      `SignedHeaders=${names.join(";")}, Signature=${signature}`,
  };
}

/** One signed request for an object in the private bucket; unreachable or refused storage answers 503. */
export async function s3Request(method: "PUT" | "GET" | "HEAD", key: string, body?: Buffer, contentType?: string): Promise<Response> {
  const url = objectUrl(key);
  const payloadHash = sha256Hex(body ?? "");
  const headers = signedHeaders(method, url, payloadHash, contentType ? { "content-type": contentType } : {});
  delete headers.host;
  try {
    const response = await fetch(url, {
      method,
      headers,
      ...(body ? { body: new Uint8Array(body) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`S3 ${method} answered ${response.status}`);
    return response;
  } catch (error) {
    console.warn(`File storage unavailable: ${error instanceof Error ? error.message : String(error)}`);
    throw new ApiError("storage_unavailable");
  }
}
