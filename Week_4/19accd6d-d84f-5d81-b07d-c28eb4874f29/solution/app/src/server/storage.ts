import { createHash, createHmac } from "node:crypto";
import { settings } from "./config";
import { outage } from "./outage";

/** MinIO cannot be reached, or answered with a server failure. */
export class StorageUnavailable extends Error {}

const REQUEST_TIMEOUT_MS = 8000;
const PROBE_TTL_MS = 1000;

const sha256Hex = (data: Uint8Array | string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();

function encodePath(path: string): string {
  return path.split("/").map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");
}

function signedRequest(method: string, key: string, payload: Uint8Array): { url: string; headers: Record<string, string> } {
  const { endpoint, bucket, pathStyle, region, accessKeyId, secretAccessKey } = settings.s3;
  const base = new URL(endpoint);
  const host = pathStyle ? base.host : `${bucket}.${base.host}`;
  const path = encodePath(pathStyle ? `/${bucket}${key ? `/${key}` : ""}` : `/${key}`);
  const moment = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = moment.slice(0, 8);
  const payloadHash = sha256Hex(payload);
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonical = [
    method, path, "", `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${moment}\n`, signedHeaders, payloadHash,
  ].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", moment, scope, sha256Hex(canonical)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  return {
    url: `${base.protocol}//${host}${path}`,
    headers: {
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": moment,
      authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

async function send(method: string, key: string, payload: Uint8Array = new Uint8Array(0)): Promise<Response> {
  if (outage.minio) throw new StorageUnavailable("storage outage");
  const { url, headers } = signedRequest(method, key, payload);
  try {
    const response = await fetch(url, {
      method,
      headers: method === "PUT" ? { ...headers, "content-type": "application/octet-stream" } : headers,
      body: method === "PUT" ? payload : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status >= 500) throw new StorageUnavailable(`storage answered ${response.status}`);
    return response;
  } catch (error) {
    throw error instanceof StorageUnavailable ? error : new StorageUnavailable(String(error));
  }
}

export async function putObject(key: string, bytes: Uint8Array): Promise<void> {
  const response = await send("PUT", key, bytes);
  if (!response.ok) throw new StorageUnavailable(`storage refused the object: ${response.status}`);
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await send("GET", key);
  if (!response.ok) throw new StorageUnavailable(`storage has no object ${key}: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

let probe: { at: number; reachable: boolean } = { at: 0, reachable: true };

/** Whether the bucket answers; the answer is reused for a second so health checks stay cheap. */
export async function storageReachable(): Promise<boolean> {
  if (outage.minio) return false;
  if (Date.now() - probe.at < PROBE_TTL_MS) return probe.reachable;
  const reachable = await send("HEAD", "").then((response) => response.ok, () => false);
  probe = { at: Date.now(), reachable };
  return reachable;
}
