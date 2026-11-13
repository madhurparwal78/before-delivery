// File storage (MinIO) over the S3 REST API with SigV4. No SDK: the app needs put, get, head and delete.
import { createHash, createHmac } from "node:crypto";
import { config } from "./config.ts";

export class StorageUnavailable extends Error {
  constructor() {
    super("File storage is unavailable.");
  }
}

function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: string | Uint8Array, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodeKey(key: string): string {
  return key.split("/").map(encodeSegment).join("/");
}

let forcedDown = false;

export const storage = {
  get isForcedDown(): boolean {
    return forcedDown;
  },

  setDown(down: boolean): void {
    forcedDown = down;
  },

  async put(key: string, body: Uint8Array | string, contentType = "application/octet-stream"): Promise<void> {
    const bytes = typeof body === "string" ? Buffer.from(body, "utf8") : body;
    const response = await send("PUT", key, bytes, { "content-type": contentType });
    if (response.status !== 200) throw new StorageUnavailable();
  },

  async get(key: string): Promise<Buffer | null> {
    const response = await send("GET", key);
    if (response.status === 404) return null;
    if (response.status !== 200) throw new StorageUnavailable();
    return Buffer.from(await response.arrayBuffer());
  },

  async has(key: string): Promise<boolean> {
    const response = await send("HEAD", key);
    if (response.status === 404) return false;
    if (response.status !== 200) throw new StorageUnavailable();
    return true;
  },

  async delete(key: string): Promise<void> {
    const response = await send("DELETE", key);
    if (response.status !== 204 && response.status !== 200 && response.status !== 404) throw new StorageUnavailable();
  },

  async reachable(): Promise<boolean> {
    try {
      const response = await send("HEAD", "");
      return response.status === 200 || response.status === 403;
    } catch {
      return false;
    }
  },

  async ensureBucket(): Promise<void> {
    try {
      const response = await send("HEAD", "");
      if (response.status === 404) await send("PUT", "", new Uint8Array());
    } catch {
      return;
    }
  },
};

function target(key: string): { url: URL; canonicalPath: string } {
  const { endpoint, bucket, forcePathStyle } = config.s3;
  const base = new URL(endpoint);
  if (forcePathStyle) {
    const canonicalPath = key === "" ? `/${encodeSegment(bucket)}` : `/${encodeSegment(bucket)}/${encodeKey(key)}`;
    return { url: new URL(`${base.protocol}//${base.host}${canonicalPath}`), canonicalPath };
  }
  const canonicalPath = key === "" ? "/" : `/${encodeKey(key)}`;
  return { url: new URL(`${base.protocol}//${bucket}.${base.host}${canonicalPath}`), canonicalPath };
}

async function send(method: string, key: string, body: Uint8Array = new Uint8Array(), extra: Record<string, string> = {}): Promise<Response> {
  if (forcedDown || config.s3.endpoint === "") throw new StorageUnavailable();
  const { url, canonicalPath } = target(key);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate, ...extra };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [method, canonicalPath, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, day), config.s3.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  headers["authorization"] = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  try {
    const init: RequestInit = { method, headers, signal: AbortSignal.timeout(8000) };
    if (method === "PUT") init.body = Buffer.from(body);
    return await fetch(url, init);
  } catch {
    throw new StorageUnavailable();
  }
}
