import { AwsClient } from "aws4fetch";
import { config } from "./config.ts";
import { unavailable } from "./http.ts";

const REACH_MS = 1500;

const client = new AwsClient({
  accessKeyId: config.s3.accessKeyId,
  secretAccessKey: config.s3.secretAccessKey,
  region: config.s3.region,
  service: "s3",
});

function objectUrl(key: string): string {
  const path = key.split("/").map(encodeURIComponent).join("/");
  if (config.s3.forcePathStyle) return `${config.s3.endpoint}/${config.s3.bucket}/${path}`;
  const endpoint = new URL(config.s3.endpoint);
  return `${endpoint.protocol}//${config.s3.bucket}.${endpoint.host}/${path}`;
}

export function attachmentKey(accountId: string, attachmentId: string): string {
  return `attachments/${accountId}/${attachmentId}`;
}

async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await client.fetch(url, init);
  } catch {
    throw unavailable();
  }
}

export async function storageReachable(): Promise<boolean> {
  try {
    const answer = await client.fetch(objectUrl(""), { method: "HEAD", signal: AbortSignal.timeout(REACH_MS) });
    return answer.ok;
  } catch {
    return false;
  }
}

export async function requireStorage(): Promise<void> {
  if (!(await storageReachable())) throw unavailable();
}

export async function putObject(key: string, bytes: Buffer, contentType: string): Promise<void> {
  const answer = await send(objectUrl(key), { method: "PUT", body: bytes, headers: { "Content-Type": contentType } });
  if (!answer.ok) throw unavailable();
}

export async function getObject(key: string): Promise<Buffer> {
  const answer = await send(objectUrl(key), { method: "GET" });
  if (!answer.ok) throw unavailable();
  return Buffer.from(await answer.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const answer = await send(objectUrl(key), { method: "DELETE" });
  if (!answer.ok && answer.status !== 404) throw unavailable();
}
