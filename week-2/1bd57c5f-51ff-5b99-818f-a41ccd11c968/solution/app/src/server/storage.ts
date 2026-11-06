import { AwsClient } from "aws4fetch";
import { config } from "./config";
import { fail } from "./errors";

// The S3-compatible object store holding plan images and photos. Any transport failure
// or server error answers storage_unavailable, so a caller never records a missing object.

const client = new AwsClient({
  accessKeyId: config.s3.accessKeyId,
  secretAccessKey: config.s3.secretAccessKey,
  service: "s3",
  region: config.s3.region,
  retries: 0,
});

function objectUrl(key: string): string {
  const path = key.split("/").map(encodeURIComponent).join("/");
  if (config.s3.forcePathStyle) return `${config.s3.endpoint}/${config.s3.bucket}/${path}`;
  const endpoint = new URL(config.s3.endpoint);
  return `${endpoint.protocol}//${config.s3.bucket}.${endpoint.host}/${path}`;
}

async function call(key: string, init: RequestInit): Promise<Response> {
  try {
    return await client.fetch(objectUrl(key), { ...init, signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    console.error("object store unreachable:", (error as Error).message);
    fail("storage_unavailable");
  }
}

/** Stores an object; resolves only once the store has confirmed it. */
export async function putObject(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const response = await call(key, { method: "PUT", body: bytes.slice(), headers: { "Content-Type": contentType } });
  if (!response.ok) {
    console.error(`object store refused PUT ${key}: ${response.status}`);
    fail("storage_unavailable");
  }
}

/** The object's bytes, or null when the store has no such object. */
export async function getObject(key: string): Promise<Uint8Array | null> {
  const response = await call(key, { method: "GET" });
  if (response.status === 404) return null;
  if (!response.ok) fail("storage_unavailable");
  return new Uint8Array(await response.arrayBuffer());
}

/** Removes an object; an object that is already gone counts as removed. */
export async function deleteObject(key: string): Promise<void> {
  const response = await call(key, { method: "DELETE" });
  if (!response.ok && response.status !== 404) fail("storage_unavailable");
}
