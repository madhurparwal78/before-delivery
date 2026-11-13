import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import config from './config.js';
import { createHash } from 'node:crypto';

export const s3 = new S3Client({
  region: config.s3.region,
  endpoint: config.s3.endpoint,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey },
});

export class StorageUnavailable extends Error {}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  try {
    await s3.send(new PutObjectCommand({ Bucket: config.s3.bucket, Key: key, Body: body, ContentType: contentType }));
  } catch {
    throw new StorageUnavailable();
  }
}

export async function getObject(key: string): Promise<Buffer> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
    const bytes = await res.Body?.transformToByteArray();
    return Buffer.from(bytes ?? new Uint8Array());
  } catch {
    throw new StorageUnavailable();
  }
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: config.s3.bucket, Key: key }));
    return true;
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === 'NotFound' || name === 'NoSuchKey') return false;
    throw new StorageUnavailable();
  }
}

export async function deleteObject(key: string): Promise<void> {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: key }));
  } catch {
    throw new StorageUnavailable();
  }
}

export function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function originalKey(accountId: string, modelId: string): string {
  return `models/${accountId}/${modelId}/original.glb`;
}

export function thumbnailKey(accountId: string, modelId: string): string {
  return `models/${accountId}/${modelId}/thumbnail.png`;
}
