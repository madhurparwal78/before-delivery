import { createHash, createHmac } from "node:crypto";
import { config } from "./config.ts";

// A minimal S3 client (Signature V4) for the snapshot bucket (brief: Services / MinIO).
export class StorageUnreachable extends Error {}

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

function objectUrl(key: string): URL {
  const endpoint = new URL(config.s3.endpoint);
  const path = key.split("/").map(encodeURIComponent).join("/");
  if (config.s3.forcePathStyle) return new URL(`${endpoint.origin}/${config.s3.bucket}${path ? `/${path}` : ""}`);
  return new URL(`${endpoint.protocol}//${config.s3.bucket}.${endpoint.host}/${path}`);
}

async function send(method: "GET" | "PUT" | "HEAD", key: string, body?: Buffer, contentType?: string): Promise<Response> {
  const url = objectUrl(key);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body ?? "");
  const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const signedHeaders = Object.keys(headers).join(";");
  const canonical = [
    method,
    url.pathname,
    "",
    Object.entries(headers).map(([name, value]) => `${name}:${value}\n`).join(""),
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  let signingKey = hmac(`AWS4${config.s3.secretAccessKey}`, day);
  for (const part of [config.s3.region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const { host: _host, ...sent } = headers;
  try {
    return await fetch(url, {
      method,
      body: body ? new Uint8Array(body) : undefined,
      headers: {
        ...sent,
        ...(contentType ? { "Content-Type": contentType } : {}),
        Authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new StorageUnreachable("MinIO is unreachable");
  }
}

export async function ensureBucket(): Promise<void> {
  if ((await send("HEAD", "")).status === 404) await send("PUT", "");
}

// Writes the object once: an object that is already there is never overwritten.
export async function storeOnce(key: string, body: string): Promise<void> {
  const head = await send("HEAD", key);
  if (head.status === 200) return;
  const put = await send("PUT", key, Buffer.from(body, "utf8"), "application/json");
  if (put.status !== 200) throw new StorageUnreachable(`MinIO refused ${key} (${put.status})`);
}

export async function fetchObject(key: string): Promise<Buffer> {
  const response = await send("GET", key);
  if (response.status !== 200) throw new StorageUnreachable(`MinIO answered ${response.status} for ${key}`);
  return Buffer.from(await response.arrayBuffer());
}

export function snapshotKey(gameweek: number, managerId: string): string {
  return `snapshots/gw-${String(gameweek).padStart(2, "0")}/${managerId}.json`;
}
