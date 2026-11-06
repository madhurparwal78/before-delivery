import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3';
import { config } from './config.js';

const client = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey },
});

let bucketReady = false;

export async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.s3.bucket }));
    bucketReady = true;
  } catch {
    try {
      await client.send(new CreateBucketCommand({ Bucket: config.s3.bucket }));
    } catch { /* may already exist */ }
    bucketReady = true;
  }
}

export function regionKey(region: string, bucket: string, versionId: string): string {
  return `regions/${region}/${bucket}/${versionId}`;
}

export function partKey(uploadId: string, partNumber: number): string {
  return `uploads/${uploadId}/${partNumber}`;
}

export async function putRegionCiphertext(region: string, bucket: string, versionId: string, data: Buffer): Promise<void> {
  await ensureBucket();
  await client.send(new PutObjectCommand({ Bucket: config.s3.bucket, Key: regionKey(region, bucket, versionId), Body: data }));
}

export async function getRegionCiphertext(region: string, bucket: string, versionId: string): Promise<Buffer | null> {
  try {
    await ensureBucket();
    const r = await client.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: regionKey(region, bucket, versionId) }));
    const body = r.Body as { transformToByteArray(): Promise<Uint8Array> } | undefined;
    if (body && typeof body.transformToByteArray === 'function') {
      return Buffer.from(await body.transformToByteArray());
    }
    return null;
  } catch { return null; }
}

export async function deleteRegionCiphertext(region: string, bucket: string, versionId: string): Promise<void> {
  try {
    await client.send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: regionKey(region, bucket, versionId) }));
  } catch { /* retried by the removal worker */ }
}

export async function putPart(uploadId: string, partNumber: number, data: Buffer): Promise<void> {
  await ensureBucket();
  await client.send(new PutObjectCommand({ Bucket: config.s3.bucket, Key: partKey(uploadId, partNumber), Body: data }));
}

export async function getPart(uploadId: string, partNumber: number): Promise<Buffer | null> {
  try {
    const r = await client.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: partKey(uploadId, partNumber) }));
    const body = r.Body as { transformToByteArray(): Promise<Uint8Array> } | undefined;
    if (body && typeof body.transformToByteArray === 'function') {
      return Buffer.from(await body.transformToByteArray());
    }
    return null;
  } catch { return null; }
}

export async function deletePart(uploadId: string, partNumber: number): Promise<void> {
  try {
    await client.send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: partKey(uploadId, partNumber) }));
  } catch { /* best effort */ }
}

export async function deletePartPrefix(uploadId: string, partNumbers: number[]): Promise<void> {
  for (const n of partNumbers) await deletePart(uploadId, n);
}
