// A small S3 client (Signature V4) for the provisioned bucket: checksummed writes, streamed reads.
import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";

const EMPTY_SHA = createHash("sha256").update("").digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();
const encodeKey = (key: string) => key.split("/").map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");

function target(key: string, query = ""): { url: string; host: string; path: string } {
  const endpoint = new URL(config.s3.endpoint);
  const bucket = config.s3.bucket;
  if (config.s3.forcePathStyle) {
    const path = `/${bucket}${key ? `/${encodeKey(key)}` : ""}`;
    return { url: `${endpoint.origin}${path}${query ? `?${query}` : ""}`, host: endpoint.host, path };
  }
  const host = `${bucket}.${endpoint.host}`;
  const path = `/${key ? encodeKey(key) : ""}`;
  return { url: `${endpoint.protocol}//${host}${path}${query ? `?${query}` : ""}`, host, path };
}

function signedHeaders(method: string, host: string, path: string, query: string, payloadSha: string, extra: Record<string, string>): Record<string, string> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadSha, "x-amz-date": amzDate, ...extra };
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim()]));
  const canonical = [method, path, query, names.map((n) => `${n}:${lower[n]}\n`).join(""), names.join(";"), payloadSha].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
  let key: Buffer = hmac(`AWS4${config.s3.secretAccessKey}`, day);
  for (const part of [config.s3.region, "s3", "aws4_request"]) key = hmac(key, part);
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  const { host: _host, ...rest } = headers;
  return { ...rest, Authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` };
}

/** Thrown for every storage failure; callers answer the storage 503 and never pass its details on. */
export class StorageError extends Error {}

/** Writes exactly `data`; storage verifies its own SHA-256 checksum against the declared one. */
export async function putObject(key: string, data: Buffer, sha256Hex: string, contentType: string): Promise<void> {
  const { url, host, path } = target(key);
  const headers = signedHeaders("PUT", host, path, "", sha256Hex, {
    "content-type": contentType,
    "x-amz-checksum-sha256": Buffer.from(sha256Hex, "hex").toString("base64"),
  });
  let response: Response;
  try {
    response = await fetch(url, { method: "PUT", headers: { ...headers, "Content-Length": String(data.length) }, body: data, signal: AbortSignal.timeout(60_000) });
  } catch {
    throw new StorageError("unreachable");
  }
  await response.arrayBuffer().catch(() => undefined);
  if (!response.ok) throw new StorageError(`refused ${response.status}`);
}

/** Opens a stored object for streaming; `signal` aborts the transfer when the client leaves. */
export async function getObject(key: string, signal: AbortSignal): Promise<Response> {
  const { url, host, path } = target(key);
  const headers = signedHeaders("GET", host, path, "", EMPTY_SHA, {});
  let response: Response;
  try {
    response = await fetch(url, { headers, signal });
  } catch {
    throw new StorageError("unreachable");
  }
  if (!response.ok) {
    await response.arrayBuffer().catch(() => undefined);
    throw new StorageError(`refused ${response.status}`);
  }
  return response;
}

/** Whether the bucket answers a one-key listing within three seconds. */
export async function storageReachable(): Promise<boolean> {
  const query = "list-type=2&max-keys=1";
  const { url, host, path } = target("", query);
  try {
    const response = await fetch(url, { headers: signedHeaders("GET", host, path, query, EMPTY_SHA, {}), signal: AbortSignal.timeout(3000) });
    await response.arrayBuffer();
    return response.ok;
  } catch {
    return false;
  }
}
