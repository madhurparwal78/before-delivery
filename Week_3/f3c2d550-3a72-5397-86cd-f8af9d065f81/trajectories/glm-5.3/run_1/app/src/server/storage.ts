// MinIO access through the AWS SDK. The bucket is private; the browser sees
// photos and PDFs only through the app's own endpoints.

import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { createHash, randomUUID } from "node:crypto";
import type { Readable } from "node:stream";

const endpoint = process.env.S3_ENDPOINT!;
export const bucket = process.env.S3_BUCKET!;

export const s3 = new S3Client({
  region: process.env.S3_REGION ?? "us-east-1",
  endpoint,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
});

export interface StoredObject { buf: Buffer; contentType?: string }

export async function s3Get(key: string): Promise<StoredObject | null> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const chunks = await (res.Body as Readable).toArray();
    return { buf: Buffer.concat(chunks), contentType: res.ContentType };
  } catch (err) {
    if ((err as { name?: string }).name === "NoSuchKey") return null;
    throw err;
  }
}
export async function s3Put(key: string, body: Buffer, contentType: string): Promise<void> {
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
}

export async function s3Delete(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

// Write then read back and confirm byte count and SHA-256 (Business rules).
export async function s3PutConfirmed(key: string, body: Buffer, contentType: string): Promise<void> {
  await s3Put(key, body, contentType);
  const back = await s3Get(key);
  if (!back) throw new Error("storage read-back missing");
  const sha = createHash("sha256").update(back.buf).digest("hex");
  if (back.buf.length !== body.length || sha !== createHash("sha256").update(body).digest("hex")) {
    throw new Error("storage read-back mismatch");
  }
}

export function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export async function storageUp(): Promise<boolean> {
  try {
    await s3.send(new GetObjectCommand({ Bucket: bucket, Key: "health/stowdeck-probe" }));
    return true;
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === "NoSuchKey") return true;
    return false;
  }
}
