import { createHmac } from "node:crypto";
import { config } from "./config";
import { sha256Hex } from "./digest";
import { ApiError } from "./errors";
import { logged } from "./failures";

/** Storage did not answer or refused the request. */
export class StorageError extends Error {}

const TIMEOUT_MS = 4000;
const { endpoint, region, bucket, forcePathStyle, accessKeyId, secretAccessKey } = config.s3;

interface Call {
  query?: Record<string, string>;
  body?: Buffer;
  contentType?: string;
  timeoutMs?: number;
  okStatuses?: number[];
}

const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();
const encode = (part: string): string => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function signingKey(dateStamp: string): Buffer {
  return [region, "s3", "aws4_request"].reduce((key, part) => hmac(key, part), hmac(`AWS4${secretAccessKey}`, dateStamp));
}

/** One AWS Signature V4 request to the bucket (or to an object in it), path-style or virtual-hosted. */
async function send(method: string, key: string | null, call: Call = {}): Promise<Response> {
  const base = new URL(endpoint);
  const host = forcePathStyle ? base.host : `${bucket}.${base.host}`;
  const objectPath = key === null ? "" : `/${key.split("/").map(encode).join("/")}`;
  const path = (forcePathStyle ? `/${encode(bucket)}` : "") + objectPath || "/";
  const query = Object.entries(call.query ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, value]) => `${encode(name)}=${encode(value)}`).join("&");

  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(call.body ?? "");
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonical = [
    method, path, query,
    `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`,
    signedHeaders, payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const signature = hmac(signingKey(dateStamp), `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256Hex(canonical)}`).toString("hex");

  const headers: Record<string, string> = {
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (call.contentType) headers["content-type"] = call.contentType;

  let response: Response;
  try {
    response = await fetch(`${base.protocol}//${host}${path}${query ? `?${query}` : ""}`, {
      method, headers, body: call.body && new Uint8Array(call.body.buffer, call.body.byteOffset, call.body.byteLength), signal: AbortSignal.timeout(call.timeoutMs ?? TIMEOUT_MS),
    });
  } catch (cause) {
    throw new StorageError("storage did not answer", { cause });
  }
  if (!response.ok && !call.okStatuses?.includes(response.status)) {
    await response.arrayBuffer().catch(logged("storage error body", undefined));
    throw new StorageError(`storage answered ${response.status}`);
  }
  return response;
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await send("PUT", key, { body, contentType });
}

export async function getObject(key: string): Promise<Buffer> {
  return Buffer.from(await (await send("GET", key)).arrayBuffer());
}

async function deleteObject(key: string): Promise<void> {
  await send("DELETE", key, { okStatuses: [404] });
}

const DELETE_PARALLELISM = 16;

/** Deletes each key, a few at a time; returns the keys storage confirmed gone. */
export async function deleteObjects(keys: readonly string[]): Promise<string[]> {
  const deleted: string[] = [];
  for (let start = 0; start < keys.length; start += DELETE_PARALLELISM) {
    await Promise.all(keys.slice(start, start + DELETE_PARALLELISM).map((key) =>
      deleteObject(key).then(() => void deleted.push(key), () => undefined)));
  }
  return deleted;
}

const XML_ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };

export async function listObjects(prefix = ""): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const xml = await (await send("GET", null, { query: { "list-type": "2", prefix, ...(token && { "continuation-token": token }) } })).text();
    for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) {
      keys.push((match[1] ?? "").replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => XML_ENTITIES[entity] ?? entity));
    }
    token = xml.includes("<IsTruncated>true</IsTruncated>") ? /<NextContinuationToken>([^<]*)</.exec(xml)?.[1] : undefined;
  } while (token);
  return keys;
}

/** Answers when the bucket does, within the given time. */
export async function pingStorage(timeoutMs: number): Promise<void> {
  await send("HEAD", null, { timeoutMs });
}

export async function ensureBucket(): Promise<void> {
  await send("PUT", null, { okStatuses: [409] });
}

/** Runs a storage operation; a storage failure becomes `503 storage_unavailable` with the route's copy. */
export async function whenStorageUp<T>(message: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof StorageError) throw new ApiError("storage_unavailable", { message });
    throw error;
  }
}
