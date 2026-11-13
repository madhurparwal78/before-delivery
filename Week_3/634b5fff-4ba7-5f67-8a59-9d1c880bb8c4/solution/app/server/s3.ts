import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";

/** A small signed S3 client for MinIO: put, get, head and bucket creation. */

export class StorageUnreachable extends Error {
  constructor() {
    super("storage unreachable");
  }
}

const sha256 = (data: Uint8Array | string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Uint8Array | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();
const encode = (value: string): string =>
  encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

const request = async (method: string, key: string, body?: Uint8Array, contentType?: string): Promise<Response> => {
  const { endpoint, region, bucket, forcePathStyle, accessKeyId, secretAccessKey } = config.s3;
  const url = new URL(endpoint);
  if (!forcePathStyle) url.hostname = `${bucket}.${url.hostname}`;
  const objectPath = key ? `/${key.split("/").map(encode).join("/")}` : "";
  const path = forcePathStyle ? `/${bucket}${objectPath}` : objectPath || "/";
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const payload = sha256(body ?? "");
  const signedHeaders: Record<string, string> = { host: url.host, "x-amz-content-sha256": payload, "x-amz-date": amzDate };
  if (contentType) signedHeaders["content-type"] = contentType;
  const names = Object.keys(signedHeaders).sort();
  const canonical = [
    method, path, "", names.map((name) => `${name}:${signedHeaders[name]}\n`).join(""), names.join(";"), payload,
  ].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonical)}`;
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  const headers = {
    ...signedHeaders,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
  };
  try {
    return await fetch(`${url.origin}${path}`, { method, headers, body: body ? Buffer.from(body) : undefined, signal: AbortSignal.timeout(20000) });
  } catch {
    throw new StorageUnreachable();
  }
};

const checked = (response: Response): Response => {
  if (response.status >= 500) throw new StorageUnreachable();
  return response;
};

export const ensureBucket = async (): Promise<void> => {
  const head = checked(await request("HEAD", ""));
  if (head.status === 404) checked(await request("PUT", ""));
};

export const putObject = async (key: string, body: Uint8Array, contentType: string): Promise<void> => {
  const response = checked(await request("PUT", key, body, contentType));
  if (!response.ok) throw new StorageUnreachable();
};

export const getObject = async (key: string): Promise<Buffer | null> => {
  const response = checked(await request("GET", key));
  return response.ok ? Buffer.from(await response.arrayBuffer()) : null;
};

export const hasObject = async (key: string): Promise<boolean> => checked(await request("HEAD", key)).ok;
