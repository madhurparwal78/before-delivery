// Photo storage in the S3-compatible bucket (MinIO), with SigV4-signed requests.

import aws4 from "aws4";
import { config } from "../config.js";

/** The bucket could not be reached or failed; callers answer `photo_storage_unavailable`. */
export class StorageUnavailable extends Error {}

const CALL_TIMEOUT_MS = 4_500;

function target(key: string): { host: string; path: string; origin: string } {
  const endpoint = new URL(config.s3.endpoint);
  const objectPath = key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  if (config.s3.forcePathStyle) {
    return { host: endpoint.host, path: `/${config.s3.bucket}${objectPath ? `/${objectPath}` : ""}`, origin: endpoint.origin };
  }
  const host = `${config.s3.bucket}.${endpoint.host}`;
  return { host, path: `/${objectPath}`, origin: `${endpoint.protocol}//${host}` };
}

async function send(method: "PUT" | "GET" | "DELETE" | "HEAD", key: string, body?: Buffer, contentType?: string): Promise<Response> {
  const { host, path, origin } = target(key);
  const signed = aws4.sign(
    {
      host,
      path,
      method,
      service: "s3",
      region: config.s3.region,
      headers: contentType ? { "Content-Type": contentType } : {},
      ...(body ? { body } : {}),
    },
    { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey },
  );
  const headers = Object.fromEntries(
    Object.entries(signed.headers ?? {})
      .filter(([name]) => !["host", "content-length"].includes(name.toLowerCase()))
      .map(([name, value]) => [name, String(value)]),
  );
  try {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers,
      body: body ? new Uint8Array(body) : null,
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    if (response.status >= 500) throw new Error(`status ${response.status}`);
    return response;
  } catch (error) {
    console.error(`photo storage ${method} failed: ${(error as Error).name}`);
    throw new StorageUnavailable();
  }
}

export async function putObject(key: string, data: Buffer, contentType: string): Promise<void> {
  const response = await send("PUT", key, data, contentType);
  if (!response.ok) throw new StorageUnavailable();
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await send("GET", key);
  if (!response.ok) throw new StorageUnavailable();
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const response = await send("DELETE", key);
  if (!response.ok && response.status !== 404) throw new StorageUnavailable();
}

export async function storageReachable(): Promise<boolean> {
  try {
    return (await send("HEAD", "")).ok;
  } catch {
    return false;
  }
}
