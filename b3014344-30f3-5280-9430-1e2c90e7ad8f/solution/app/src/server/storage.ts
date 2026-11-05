import { createHash, createHmac } from "node:crypto";
import { config } from "./config";
import { errors } from "./http";

// MinIO over the S3 API with SigV4 signing. Each call connects afresh; failures surface as 503.

const { endpoint, region, bucket, forcePathStyle, accessKeyId, secretAccessKey } = config.s3;
const base = new URL(endpoint);

function encodeKey(key: string): string {
  return key.split("/").map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");
}

function target(key: string): { url: URL; canonicalPath: string } {
  const path = key ? `/${encodeKey(key)}` : "/";
  if (forcePathStyle) {
    const canonicalPath = `/${bucket}${key ? path : ""}`;
    return { url: new URL(`${base.origin}${canonicalPath}`), canonicalPath };
  }
  return { url: new URL(`${base.protocol}//${bucket}.${base.host}${path}`), canonicalPath: path };
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

async function s3(method: string, key: string, body?: Buffer, query: Record<string, string> = {}, timeoutMs = 15_000): Promise<Response> {
  const { url, canonicalPath } = target(key);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = createHash("sha256").update(body ?? Buffer.alloc(0)).digest("hex");
  const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalQuery = [...url.searchParams.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const canonical = [
    method,
    canonicalPath,
    canonicalQuery,
    Object.keys(headers).sort().map((name) => `${name}:${headers[name]}\n`).join(""),
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${createHash("sha256").update(canonical).digest("hex")}`;
  let signingKey = hmac(`AWS4${secretAccessKey}`, day);
  for (const part of [region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  try {
    return await fetch(url, { method, headers, body: body ? new Uint8Array(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw errors.storage();
  }
}

/** Creates the bucket when it does not exist yet (an outage copy may run on its own bucket). */
async function ensureBucket(): Promise<void> {
  const head = await s3("HEAD", "");
  if (head.status === 200) return;
  const created = await s3("PUT", "");
  if (created.status !== 200 && created.status !== 409) throw errors.storage();
}

export async function putObject(key: string, data: Buffer): Promise<void> {
  let response = await s3("PUT", key, data);
  if (response.status === 404) {
    await ensureBucket();
    response = await s3("PUT", key, data);
  }
  if (response.status !== 200) throw errors.storage();
}

export async function getObject(key: string): Promise<Response> {
  const response = await s3("GET", key, undefined, {}, 60_000);
  if (response.status !== 200) throw errors.storage();
  return response;
}

export async function deleteObject(key: string): Promise<void> {
  const response = await s3("DELETE", key);
  if (response.status !== 204 && response.status !== 200 && response.status !== 404) throw errors.storage();
}

export async function storageHealthy(): Promise<boolean> {
  try {
    const response = await fetch(`${base.origin}/minio/health/live`, { signal: AbortSignal.timeout(1_500) });
    return response.status === 200;
  } catch {
    return false;
  }
}

export const objectKeys = {
  portal: (orderId: string) => `portal/${orderId}/.portal`,
  file: (orderId: string, kind: "asset" | "deliverable", fileId: string, name: string) =>
    `portal/${orderId}/${kind === "asset" ? "assets" : "deliverables"}/${fileId}/${name}`,
  invoice: (orderId: string, invoiceId: string) => `portal/${orderId}/invoices/${invoiceId}.pdf`,
};
