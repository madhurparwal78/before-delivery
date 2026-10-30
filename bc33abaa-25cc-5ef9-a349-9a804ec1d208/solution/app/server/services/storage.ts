// MinIO over the S3 API, signed with AWS Signature Version 4. Every object lives under ws/<workspaceId>/.
import { createHash, createHmac } from "node:crypto";
import { config } from "../config.js";
import { unavailable } from "../errors.js";

const { endpoint, region, bucket, forcePathStyle, accessKeyId, secretAccessKey } = config.storage;

export const keys = {
  snapshot: (ws: string, scene: string, version: string) => `ws/${ws}/scenes/${scene}/versions/${version}/snapshot.json`,
  thumbnail: (ws: string, scene: string, version: string) => `ws/${ws}/scenes/${scene}/versions/${version}/thumbnail.png`,
  asset: (ws: string, asset: string) => `ws/${ws}/assets/${asset}`,
  published: (ws: string, embedId: string) => `ws/${ws}/published/${embedId}/scene.json`,
  exportBundle: (ws: string, exportId: string) => `ws/${ws}/exports/${exportId}.zip`,
  invoice: (ws: string, invoiceId: string) => `ws/${ws}/invoices/${invoiceId}.pdf`,
};

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

function objectUrl(key: string): URL {
  const base = new URL(endpoint);
  const path = key.split("/").map(encodeURIComponent).join("/");
  if (forcePathStyle) return new URL(`${base.origin}/${bucket}${key ? `/${path}` : ""}`);
  return new URL(`${base.protocol}//${bucket}.${base.host}/${path}`);
}

async function send(method: string, key: string, body?: Buffer, contentType?: string, timeoutMs = 15_000): Promise<Response> {
  const url = objectUrl(key);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body ?? "");
  const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const signed = Object.keys(headers).sort();
  const canonical = [method, url.pathname, "", signed.map((h) => `${h}:${headers[h]}\n`).join(""), signed.join(";"), payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  let signingKey = hmac(`AWS4${secretAccessKey}`, day);
  for (const part of [region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const sent: Record<string, string> = {
    "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signed.join(";")}, Signature=${signature}`,
  };
  if (contentType) sent["content-type"] = contentType;
  let response: Response;
  try {
    response = await fetch(url, { method, headers: sent, body: body ? new Uint8Array(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw unavailable("file_storage");
  }
  if (response.status >= 500 || response.status === 403) throw unavailable("file_storage");
  return response;
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await send("PUT", key, body, contentType);
  if (!response.ok) throw unavailable("file_storage");
}

/** The object's bytes, or null when it does not exist. */
export async function getObject(key: string, timeoutMs?: number): Promise<Buffer | null> {
  const response = await send("GET", key, undefined, undefined, timeoutMs);
  if (response.status === 404) return null;
  if (!response.ok) throw unavailable("file_storage");
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  await send("DELETE", key);
}

/** Answers the file storage outage before work that must not start without it. */
export async function assertStorageReachable(): Promise<void> {
  const response = await send("HEAD", "");
  if (!response.ok) throw unavailable("file_storage");
}
