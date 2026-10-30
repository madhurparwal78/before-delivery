import { createHash, createHmac } from "node:crypto";
import { config } from "../config.js";
import { storageUnavailable } from "../http/errors.js";

// The S3 bucket (MinIO) over signed HTTP requests (AWS Signature Version 4). Every stored file lives here;
// any failure to reach the bucket is the brief's 503 storage_unavailable.

const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();
const encodeKey = (key: string): string => key.split("/").map((part) => encodeURIComponent(part)).join("/");

interface S3Response {
  status: number;
  body: Buffer;
  headers: Headers;
}

async function request(method: "GET" | "PUT" | "DELETE" | "HEAD", key: string, body: Buffer = Buffer.alloc(0),
  contentType?: string): Promise<S3Response> {
  const { endpoint, region, bucket, forcePathStyle, accessKeyId, secretAccessKey } = config.s3;
  const base = new URL(endpoint);
  const host = forcePathStyle ? base.host : `${bucket}.${base.host}`;
  const path = forcePathStyle ? `/${bucket}/${encodeKey(key)}` : `/${encodeKey(key)}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (contentType) headers["content-type"] = contentType;
  const signedNames = Object.keys(headers).sort();
  const canonical = [method, path, "", signedNames.map((name) => `${name}:${headers[name]}\n`).join(""),
    signedNames.join(";"), payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  let signingKey = hmac(`AWS4${secretAccessKey}`, day);
  for (const part of [region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedNames.join(";")}, Signature=${signature}`;
  const sent = Object.fromEntries(Object.entries(headers).filter(([name]) => name !== "host"));
  try {
    const response = await fetch(`${base.protocol}//${host}${path}`, {
      method, headers: { ...sent, authorization }, body: method === "PUT" ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    return { status: response.status, body: Buffer.from(await response.arrayBuffer()), headers: response.headers };
  } catch {
    throw storageUnavailable();
  }
}

export async function putObject(key: string, data: Buffer, contentType: string): Promise<void> {
  const response = await request("PUT", key, data, contentType);
  if (response.status !== 200) throw storageUnavailable();
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await request("GET", key);
  if (response.status !== 200) throw storageUnavailable();
  return response.body;
}

export async function objectExists(key: string): Promise<boolean> {
  const response = await request("HEAD", key);
  if (response.status === 200) return true;
  if (response.status === 404) return false;
  throw storageUnavailable();
}

/** Removes an object, best effort: used to leave no partial object behind after a failed write. */
export async function deleteObject(key: string): Promise<void> {
  await request("DELETE", key).catch(() => undefined);
}
