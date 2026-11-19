// MinIO object storage through signed S3 requests. Every call tries the service afresh.
import { createHash, createHmac } from "node:crypto";
import { config } from "./config.ts";
import { fail } from "./http.ts";

const sha256Hex = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();

function encodeKey(key: string): string {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

async function signedRequest(method: "GET" | "HEAD" | "PUT" | "DELETE", key: string, body?: Buffer, contentType?: string): Promise<Response> {
  const endpoint = new URL(config.s3.endpoint);
  const host = config.s3.forcePathStyle ? endpoint.host : `${config.s3.bucket}.${endpoint.host}`;
  const path = config.s3.forcePathStyle ? `/${encodeKey(config.s3.bucket)}/${encodeKey(key)}` : `/${encodeKey(key)}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body ?? "");
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [method, path, "", names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256Hex(canonical)}`;
  let signingKey = hmac(`AWS4${config.s3.secretAccessKey}`, day);
  for (const part of [config.s3.region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const { host: _host, ...sent } = headers;
  try {
    return await fetch(`${endpoint.protocol}//${host}${path}`, {
      method,
      headers: {
        ...sent,
        authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
      },
      body: body ? new Uint8Array(body) : null,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw fail.storage();
  }
}

export async function putObject(key: string, data: Buffer, contentType: string): Promise<void> {
  const answer = await signedRequest("PUT", key, data, contentType);
  await answer.arrayBuffer().catch(() => undefined);
  if (!answer.ok) throw fail.storage();
}

/** The object's bytes; a missing object is a storage failure too, never an answer from the database alone. */
export async function getObject(key: string): Promise<Buffer> {
  const answer = await signedRequest("GET", key);
  if (!answer.ok) {
    await answer.arrayBuffer().catch(() => undefined);
    throw fail.storage();
  }
  try {
    return Buffer.from(await answer.arrayBuffer());
  } catch {
    throw fail.storage();
  }
}

/** The object's size, or null when the reachable store does not hold it. */
export async function objectSize(key: string): Promise<number | null> {
  const answer = await signedRequest("HEAD", key);
  await answer.arrayBuffer().catch(() => undefined);
  if (answer.status === 404) return null;
  if (!answer.ok) throw fail.storage();
  return Number(answer.headers.get("content-length") ?? "-1");
}

export async function deleteObject(key: string): Promise<void> {
  const answer = await signedRequest("DELETE", key);
  await answer.arrayBuffer().catch(() => undefined);
}

export const assetKey = (projectId: string, fileId: string): string => `projects/${projectId}/assets/${fileId}`;
export const exportKey = (projectId: string, exportId: string): string => `projects/${projectId}/exports/${exportId}.zip`;
