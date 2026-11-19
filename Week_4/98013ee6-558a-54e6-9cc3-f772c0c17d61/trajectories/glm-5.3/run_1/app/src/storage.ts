import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "node:stream";
import { config } from "./config";

const s3 = new S3Client({
  region: config.s3.region,
  endpoint: config.s3.endpoint,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey },
  maxAttempts: 1,
});
const BUCKET = config.s3.bucket;

export interface StorageState {
  ok: boolean;
  checkedAt: number;
  message: string | null;
}

let state: StorageState = { ok: false, checkedAt: 0, message: null };

export function storageState(): StorageState {
  return state;
}

/** Checks reachability by reading a probe key; runs at least every 5 seconds (DP-08). */
export async function checkStorage(): Promise<StorageState> {
  try {
    await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: "healthcheck" }));
    state = { ok: true, checkedAt: Date.now(), message: null };
  } catch (e) {
    const name = (e as { name?: string }).name ?? "";
    const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    // A 404 NoSuchKey means the store answered: the bucket is reachable.
    if (name === "NoSuchKey" || status === 404) state = { ok: true, checkedAt: Date.now(), message: null };
    else state = { ok: false, checkedAt: Date.now(), message: name };
  }
  return state;
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }));
}

export async function getObject(key: string): Promise<Buffer | null> {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const chunks: Buffer[] = [];
    for await (const chunk of r.Body as Readable) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  } catch (e) {
    const name = (e as { name?: string }).name;
    const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (name === "NoSuchKey" || status === 404) return null;
    throw e;
  }
}

export async function deleteObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: keys.map(Key => ({ Key })) } }));
}

/** A signed link valid for no more than 300 seconds, signed after the visibility check. */
export async function signedUrl(key: string): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 300 });
}
