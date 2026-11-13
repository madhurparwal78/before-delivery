// MinIO over the S3 protocol, signed with the environment's credentials.

import { AwsClient } from "aws4fetch";
import { config } from "./config";

const signer = new AwsClient({
  accessKeyId: config.s3.accessKeyId,
  secretAccessKey: config.s3.secretAccessKey,
  region: config.s3.region,
  service: "s3",
});

const REQUEST_WAIT_MS = 15000;

function objectUrl(key: string): string {
  const path = key.split("/").map(encodeURIComponent).join("/");
  if (config.s3.forcePathStyle) return `${config.s3.endpoint}/${config.s3.bucket}/${path}`;
  const endpoint = new URL(config.s3.endpoint);
  return `${endpoint.protocol}//${config.s3.bucket}.${endpoint.host}/${path}`;
}

export class StoreUnavailable extends Error {}

async function send(url: string, init: { method: string; body?: Uint8Array }): Promise<Response> {
  try {
    return await signer.fetch(url, {
      method: init.method,
      ...(init.body ? { body: Uint8Array.from(init.body) } : {}),
      signal: AbortSignal.timeout(REQUEST_WAIT_MS),
    });
  } catch (error) {
    throw new StoreUnavailable(String(error));
  }
}

export async function ensureBucket(): Promise<void> {
  const url = objectUrl("").replace(/\/$/, "");
  const head = await send(url, { method: "HEAD" });
  if (head.ok) return;
  const made = await send(url, { method: "PUT" });
  if (!made.ok && made.status !== 409) throw new StoreUnavailable(`bucket: ${made.status}`);
}

// Resolves only once MinIO confirms the stored object.
export async function putObject(key: string, body: Uint8Array): Promise<void> {
  const answer = await send(objectUrl(key), { method: "PUT", body });
  if (!answer.ok) throw new StoreUnavailable(`put ${key}: ${answer.status}`);
}

export async function getObject(key: string): Promise<Buffer> {
  const answer = await send(objectUrl(key), { method: "GET" });
  if (!answer.ok) throw new StoreUnavailable(`get ${key}: ${answer.status}`);
  return Buffer.from(await answer.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const answer = await send(objectUrl(key), { method: "DELETE" });
  if (!answer.ok && answer.status !== 404) throw new StoreUnavailable(`delete ${key}: ${answer.status}`);
}
