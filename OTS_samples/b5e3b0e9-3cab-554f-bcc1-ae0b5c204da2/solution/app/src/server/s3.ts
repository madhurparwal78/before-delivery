import { createHash, createHmac } from "node:crypto";
import { config } from "./config.ts";

/** MinIO or S3 could not be reached or refused the request. */
export class StorageError extends Error {}

const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();

const encodePath = (path: string): string => path.split("/").map((part) => encodeURIComponent(part)).join("/");

async function signedRequest(method: "GET" | "PUT" | "HEAD", key: string, body: Buffer = Buffer.alloc(0), contentType?: string): Promise<Response> {
  const { endpoint, region, bucket, accessKeyId, secretAccessKey } = config.s3;
  const path = `/${bucket}${key === "" ? "" : `/${encodePath(key)}`}`;
  const host = new URL(endpoint).host;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [method, path, "", names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  try {
    return await fetch(`${endpoint}${path}`, {
      method,
      headers,
      body: method === "PUT" ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new StorageError("storage unreachable");
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  let response = await signedRequest("PUT", key, body, contentType);
  if (response.status === 404) {
    await ensureBucket();
    response = await signedRequest("PUT", key, body, contentType);
  }
  if (!response.ok) throw new StorageError(`put ${key}: ${response.status}`);
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await signedRequest("GET", key);
  if (!response.ok) throw new StorageError(`get ${key}: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/** Creates the bucket when it does not exist yet. */
async function ensureBucket(): Promise<void> {
  const head = await signedRequest("HEAD", "");
  if (head.status === 404) await signedRequest("PUT", "");
}
