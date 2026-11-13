/**
 * Storage (MinIO) client: two object kinds, uploads and generation segments.
 */
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config } from "./config";

const endpoint = process.env.S3_ENDPOINT ?? "http://127.0.0.1:9000";
const region = process.env.S3_REGION ?? "us-east-1";
const bucket = process.env.S3_BUCKET ?? "spoorline";

let client: S3Client | null = null;
let storageDown = false;

function s3(): S3Client {
  if (!client) {
    client = new S3Client({
      endpoint,
      region,
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true",
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
      },
    });
  }
  return client;
}

export function setStorageDown(down: boolean): void {
  storageDown = down;
}

export function storageForcedDown(): boolean {
  return storageDown;
}

export async function putObject(key: string, bytes: Buffer): Promise<{ ok: boolean; reason?: string }> {
  if (storageDown) return { ok: false, reason: "down" };
  try {
    await s3().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes }));
    return { ok: true };
  } catch {
    return { ok: false, reason: "error" };
  }
}

export async function confirmObjectSize(key: string, bytes: number): Promise<boolean> {
  if (storageDown) return false;
  try {
    const head = await s3().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return (head.ContentLength ?? -1) === bytes;
  } catch {
    return false;
  }
}

export async function getObject(key: string): Promise<Buffer | null> {
  if (storageDown) return null;
  try {
    const res = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const chunks: Buffer[] = [];
    const stream = res.Body as AsyncIterable<Uint8Array>;
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}

export async function deleteObject(key: string): Promise<boolean> {
  if (storageDown) return false;
  try {
    await s3().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

export async function storageHealthy(): Promise<boolean> {
  if (storageDown) return false;
  try {
    await s3().send(new HeadObjectCommand({ Bucket: bucket, Key: "healthcheck" }));
    return true;
  } catch (err) {
    const name = (err as { name?: string }).name ?? "";
    if (name === "NotFound") return true;
    return false;
  }
}

export function uploadKey(space: string, sha256: string): string {
  return `uploads/${space}/${sha256}.ndjson`;
}

export function segmentKey(space: string, stream: string, generation: number): string {
  return `segments/${space}/${stream}/${generation}.ndjson`;
}
