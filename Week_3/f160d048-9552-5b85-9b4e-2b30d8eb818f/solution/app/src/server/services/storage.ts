import { createHash, createHmac } from "node:crypto";
import { config } from "../config";

export class StorageUnavailable extends Error {}

const REQUEST_MS = 8000;

const sha256 = (data: Uint8Array | string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();
const encodeKey = (key: string): string => key.split("/").map(encodeURIComponent).join("/");

type Signed = { url: string; headers: Record<string, string> };

function sign(method: string, key: string, payload: Uint8Array, contentType: string | undefined): Signed {
  const { endpoint, region, bucket, forcePathStyle, accessKeyId, secretAccessKey } = config.storage;
  const base = new URL(endpoint);
  const host = forcePathStyle || key === "" ? base.host : `${bucket}.${base.host}`;
  const path = forcePathStyle ? `/${bucket}${key === "" ? "" : `/${encodeKey(key)}`}` : `/${encodeKey(key)}`;
  const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = stamp.slice(0, 8);
  const payloadHash = sha256(payload);
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": stamp };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [
    method, path, "",
    names.map((name) => `${name}:${headers[name]}\n`).join(""),
    names.join(";"),
    payloadHash,
  ].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256(canonical)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  headers["authorization"] =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  return { url: `${base.protocol}//${host}${path}`, headers };
}

async function request(method: string, key: string, body: Uint8Array = new Uint8Array(), contentType?: string): Promise<Response> {
  const signed = sign(method, key, body, contentType);
  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: method === "PUT" ? Buffer.from(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_MS),
    });
  } catch {
    throw new StorageUnavailable("storage is unreachable");
  }
}

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  const response = await request("PUT", key, body, contentType);
  if (!response.ok) throw new StorageUnavailable(`storage answered ${response.status}`);
}

/** The stored size in bytes, or undefined when the object does not exist. */
export async function storedSize(key: string): Promise<number | undefined> {
  const response = await request("HEAD", key);
  if (response.status === 404) return undefined;
  if (!response.ok) throw new StorageUnavailable(`storage answered ${response.status}`);
  return Number(response.headers.get("content-length"));
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await request("GET", key);
  if (!response.ok) throw new StorageUnavailable(`storage answered ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const response = await request("DELETE", key);
  if (!response.ok && response.status !== 404) throw new StorageUnavailable(`storage answered ${response.status}`);
}

export async function storageReachable(): Promise<boolean> {
  try {
    const response = await request("HEAD", "");
    return response.ok;
  } catch {
    return false;
  }
}
