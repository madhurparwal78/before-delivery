// S3-compatible object storage (MinIO) with AWS Signature V4, for documents and visit-log snapshots.
import { createHash, createHmac } from "node:crypto";
import { config } from "./config.ts";
import { ApiError } from "./http.ts";

const EMPTY_HASH = createHash("sha256").update("").digest("hex");

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function encodeKey(key: string): string {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

function objectUrl(key: string): { url: string; host: string; path: string } {
  const endpoint = new URL(config.s3.endpoint);
  const path = config.s3.forcePathStyle ? `/${config.s3.bucket}/${encodeKey(key)}` : `/${encodeKey(key)}`;
  const host = config.s3.forcePathStyle ? endpoint.host : `${config.s3.bucket}.${endpoint.host}`;
  return { url: `${endpoint.protocol}//${host}${path}`, host, path };
}

function signedHeaders(method: string, host: string, path: string, payloadHash: string, extra: Record<string, string>): Record<string, string> {
  const amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate, ...extra };
  const names = Object.keys(headers).map((n) => n.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim()]));
  const canonical = [method, path, "", names.map((n) => `${n}:${lower[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
  let key: Buffer = hmac(`AWS4${config.s3.secretAccessKey}`, day);
  for (const part of [config.s3.region, "s3", "aws4_request"]) key = hmac(key, part);
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  const { host: _host, ...rest } = headers;
  return {
    ...rest,
    Authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
  };
}

async function request(method: string, key: string, body?: Buffer, extra: Record<string, string> = {}): Promise<Response> {
  const { url, host, path } = objectUrl(key);
  const payloadHash = body ? createHash("sha256").update(body).digest("hex") : EMPTY_HASH;
  try {
    const response = await fetch(url, {
      method,
      headers: signedHeaders(method, host, path, payloadHash, extra),
      body: body ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      console.error(`storage ${method} ${response.status}: ${(await response.text()).slice(0, 300)}`);
      throw new ApiError("storage_unavailable");
    }
    return response;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("storage_unavailable");
  }
}

export async function putObject(key: string, data: Buffer, contentType: string): Promise<void> {
  await request("PUT", key, data, { "content-type": contentType });
}

/**
 * Storage confirmation of a document object: the PUT is acknowledged and a HEAD reports its length, type,
 * sha256 and document id. On any mismatch or storage error the object is deleted and the answer is 503.
 */
export async function putDocumentConfirmed(key: string, data: Buffer, contentType: string, sha256: string, documentId: string): Promise<void> {
  try {
    await request("PUT", key, data, { "content-type": contentType, "x-amz-meta-sha256": sha256, "x-amz-meta-document-id": documentId });
    const { headers } = await request("HEAD", key);
    const confirmed =
      headers.get("content-length") === String(data.length) &&
      headers.get("content-type") === contentType &&
      headers.get("x-amz-meta-sha256") === sha256 &&
      headers.get("x-amz-meta-document-id") === documentId;
    if (!confirmed) throw new ApiError("storage_unavailable");
  } catch (error) {
    await request("DELETE", key).catch(() => undefined);
    throw error;
  }
}

export async function getObject(key: string): Promise<Buffer> {
  return Buffer.from(await (await request("GET", key)).arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  await request("DELETE", key);
}

export function documentKey(tenantId: string, memberId: string, documentId: string): string {
  return `documents/${tenantId}/${memberId}/${documentId}`;
}

export function snapshotKey(tenantId: string, truckId: string, linkId: string): string {
  return `visit-logs/${tenantId}/${truckId}/${linkId}.pdf`;
}
