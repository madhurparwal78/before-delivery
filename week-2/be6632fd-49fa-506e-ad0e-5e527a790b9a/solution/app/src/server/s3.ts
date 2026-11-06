// MinIO over the S3 API with AWS Signature Version 4. The bucket stays private; browsers get images via the app.
import { createHash, createHmac } from "node:crypto";
import { COPY } from "../shared/copy";
import { config } from "./config";
import { ApiError } from "./http";

const hash = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();
const encodePath = (path: string): string => path.split("/").map((s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");

export function storageDown(message: string = COPY.storageUnavailable): ApiError {
  return new ApiError(503, "storage_unavailable", message);
}

async function request(method: string, key: string, body?: Buffer, contentType?: string): Promise<Response> {
  const { endpoint, region, bucket, forcePathStyle, accessKeyId, secretAccessKey } = config.s3;
  const base = new URL(endpoint);
  const host = forcePathStyle ? base.host : `${bucket}.${base.host}`;
  const path = encodePath(forcePathStyle ? `/${bucket}${key ? `/${key}` : ""}` : `/${key}`);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payload = hash(body ?? "");
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payload, "x-amz-date": amzDate };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [method, path, "", names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), payload].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, hash(canonical)].join("\n");
  let signingKey = hmac(`AWS4${secretAccessKey}`, day);
  for (const part of [region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const { host: _host, ...sent } = headers;
  try {
    return await fetch(`${base.protocol}//${host}${path}`, {
      method,
      headers: { ...sent, Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` },
      body,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw storageDown();
  }
}

let bucketReady = false;

async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  const head = await request("HEAD", "");
  if (head.status === 404) {
    const made = await request("PUT", "");
    if (!made.ok && made.status !== 409) throw storageDown();
  } else if (!head.ok) throw storageDown();
  bucketReady = true;
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await ensureBucket();
  const answer = await request("PUT", key, body, contentType);
  if (!answer.ok) throw storageDown();
}

export async function getObject(key: string): Promise<Buffer> {
  const answer = await request("GET", key);
  if (!answer.ok) throw storageDown();
  return Buffer.from(await answer.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  await request("DELETE", key);
}
