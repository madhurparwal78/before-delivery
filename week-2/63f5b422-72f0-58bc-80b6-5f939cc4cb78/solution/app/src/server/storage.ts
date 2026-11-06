import { createHash, createHmac } from "node:crypto";
import { ApiError } from "../shared/errors.js";
import { config } from "./config.js";

/** Storage is unreachable: every caller turns this into 503 storage_unavailable or the outage page. */
export class StorageDown extends Error {}

export const storageUnavailable = () => new ApiError(503, "storage_unavailable", "File storage is unavailable.");

const outages = new Map<string, number>();

/** Grading: make every storage call for one workspace fail for `ms` of server time. */
export function simulateOutage(workspaceId: string, ms: number): void {
  outages.set(workspaceId, Date.now() + ms);
}

function guard(workspaceId: string): void {
  const until = outages.get(workspaceId);
  if (until !== undefined && Date.now() < until) throw new StorageDown("simulated outage");
}

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

function encodeKey(key: string): string {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

async function request(method: "GET" | "PUT" | "HEAD", key: string | null, body?: Buffer, contentType?: string): Promise<Response> {
  const { endpoint, bucket, region, accessKeyId, secretAccessKey, forcePathStyle } = config.s3;
  const base = new URL(endpoint);
  const host = forcePathStyle ? base.host : `${bucket}.${base.host}`;
  const path = forcePathStyle ? `/${bucket}${key ? `/${encodeKey(key)}` : ""}` : `/${key ? encodeKey(key) : ""}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body ?? "");
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [method, path, "", names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  let signingKey = hmac(`AWS4${secretAccessKey}`, day);
  for (const part of [region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  const { host: _host, ...sent } = headers;
  try {
    return await fetch(`${base.protocol}//${host}${path}`, {
      method,
      headers: { ...sent, authorization },
      body: body ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    throw new StorageDown((error as Error).message);
  }
}

async function putObject(workspaceId: string, key: string, body: Buffer, contentType: string): Promise<void> {
  guard(workspaceId);
  const response = await request("PUT", key, body, contentType);
  await response.arrayBuffer();
  if (!response.ok) throw new StorageDown(`PUT ${key}: ${response.status}`);
}

/** Read an object; null when it does not exist. */
export async function getObject(workspaceId: string, key: string): Promise<Buffer | null> {
  guard(workspaceId);
  const response = await request("GET", key);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (response.status === 404) return null;
  if (!response.ok) throw new StorageDown(`GET ${key}: ${response.status}`);
  return bytes;
}

/** Write an object, then read it back; resolves only when the stored bytes match. */
export async function putConfirmed(workspaceId: string, key: string, body: Buffer, contentType: string): Promise<void> {
  await putObject(workspaceId, key, body, contentType);
  const back = await getObject(workspaceId, key);
  if (!back || !back.equals(body)) throw new StorageDown(`read-back of ${key} did not match`);
}

export async function storageReachable(workspaceId: string): Promise<boolean> {
  try {
    guard(workspaceId);
    const response = await request("HEAD", null);
    return response.ok;
  } catch {
    return false;
  }
}
