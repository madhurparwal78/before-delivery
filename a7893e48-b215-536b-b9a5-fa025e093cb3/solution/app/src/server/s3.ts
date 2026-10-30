import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";

const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();
const encodeKey = (key: string): string => key.split("/").map((part) => encodeURIComponent(part)).join("/");

interface S3Response { status: number; body: Buffer; contentType: string | null }

/** One signed (AWS Signature V4) request against the private bucket. */
async function signed(method: "GET" | "PUT" | "HEAD", key: string, body: Buffer = Buffer.alloc(0), contentType?: string): Promise<S3Response> {
  const endpoint = new URL(config.s3.endpoint);
  const host = config.s3.forcePathStyle ? endpoint.host : `${config.s3.bucket}.${endpoint.host}`;
  const path = config.s3.forcePathStyle ? `/${config.s3.bucket}/${encodeKey(key)}` : `/${encodeKey(key)}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [method, path, "", names.map((name) => `${name}:${headers[name]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  let signingKey = hmac(`AWS4${config.s3.secretAccessKey}`, day);
  for (const part of [config.s3.region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const { host: _host, ...sent } = headers;
  const response = await fetch(`${endpoint.protocol}//${host}${path}`, {
    method,
    headers: { ...sent, authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` },
    ...(method === "PUT" ? { body } : {}),
    signal: AbortSignal.timeout(20000),
  });
  return { status: response.status, body: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get("content-type") };
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const result = await signed("PUT", key, body, contentType);
  if (result.status !== 200) throw new Error(`MinIO PUT failed with ${result.status}`);
}

export async function getObject(key: string): Promise<{ body: Buffer; contentType: string } | null> {
  const result = await signed("GET", key);
  if (result.status === 404) return null;
  if (result.status !== 200) throw new Error(`MinIO GET failed with ${result.status}`);
  return { body: result.body, contentType: result.contentType ?? "application/octet-stream" };
}

/** True when the stored object can be read. */
export async function objectReadable(key: string): Promise<boolean> {
  return (await signed("HEAD", key)).status === 200;
}

export const documentKey = (renterId: string, documentId: string): string => `renters/${renterId}/documents/${documentId}`;
export const binderKey = (siteId: string, linkId: string): string => `sites/${siteId}/binders/${linkId}.pdf`;
