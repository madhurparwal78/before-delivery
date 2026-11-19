// S3-compatible object storage over signed HTTP requests (AWS Signature V4). Each call opens its
// request against the configured endpoint afresh, so a storage outage is never remembered.
import { createHash, createHmac } from "node:crypto";
import { config } from "./config";
import { ApiError } from "./http";
import { send as sendHttp, type OutboundResponse } from "./outbound";

class StorageUnavailable extends Error {
  constructor() {
    super("Object storage is unreachable");
  }
}

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

function encodePath(key: string): string {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

function objectUrl(key: string): URL {
  const { endpoint, bucket, pathStyle } = config.s3;
  const base = new URL(endpoint);
  if (pathStyle) return new URL(`${base.origin}/${bucket}/${encodePath(key)}`);
  return new URL(`${base.protocol}//${bucket}.${base.host}/${encodePath(key)}`);
}

async function send(method: "GET" | "PUT" | "HEAD" | "DELETE", key: string, body?: Buffer, contentType?: string): Promise<OutboundResponse> {
  const url = objectUrl(key);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body ?? "");
  const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const signedHeaders = Object.keys(headers).join(";");
  const canonical = [method, url.pathname, "", ...Object.entries(headers).map(([k, v]) => `${k}:${v}`), "", signedHeaders, payloadHash].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  let signingKey = hmac(`AWS4${config.s3.secretAccessKey}`, day);
  for (const part of [config.s3.region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const sent: Record<string, string> = {
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (contentType) sent["content-type"] = contentType;
  const timeout = body && body.length > 1_000_000 ? 120_000 : 8000;
  let response: OutboundResponse;
  try {
    response = await sendHttp(url, method, sent, body, timeout);
  } catch (error) {
    noteOutage(`connection failed: ${(error as NodeJS.ErrnoException).code ?? "no answer in time"}`);
    throw new StorageUnavailable();
  }
  if (response.status >= 500 || response.status === 403) {
    noteOutage(`answered ${response.status}`);
    throw new StorageUnavailable();
  }
  noteOutage(null);
  return response;
}

let lastOutage: string | null = null;

/** Logs each change in why storage is unreachable (never the address or credentials), and its recovery. */
function noteOutage(reason: string | null): void {
  if (reason === lastOutage) return;
  if (reason) console.error(`storage unreachable: ${reason}`);
  else console.log("storage reachable");
  lastOutage = reason;
}

/** Storage work whose outage is the client's 503 storage_unavailable. */
export async function unavailableAs503<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof StorageUnavailable) throw new ApiError(503, "storage_unavailable", "Audio storage is unreachable.");
    throw error;
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const response = await send("PUT", key, body, contentType);
  if (!response.ok) throw new StorageUnavailable();
}

/** The stored bytes, or null when the object does not exist. */
export async function getObject(key: string): Promise<Buffer | null> {
  const response = await send("GET", key);
  if (response.status === 404) return null;
  if (!response.ok) throw new StorageUnavailable();
  return response.body;
}

export async function objectExists(key: string): Promise<boolean> {
  const response = await send("HEAD", key);
  if (response.status === 404) return false;
  if (!response.ok) throw new StorageUnavailable();
  return true;
}

export async function deleteObject(key: string): Promise<void> {
  await send("DELETE", key);
}

export function sessionPrefix(orgId: string, projectId: string, sessionId: string): string {
  return `orgs/${orgId}/projects/${projectId}/sessions/${sessionId}/`;
}

export function synthesisKey(orgId: string, projectId: string, jobId: string): string {
  return `orgs/${orgId}/projects/${projectId}/synthesis/${jobId}.wav`;
}
