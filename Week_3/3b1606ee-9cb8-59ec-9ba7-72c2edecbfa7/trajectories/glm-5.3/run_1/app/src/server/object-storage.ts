import { S3Client, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, CreateBucketCommand } from '@aws-sdk/client-s3';
import { config } from './config.js';

let client: S3Client;
let available = false;
let lastProbeAt = 0;
const PROBE_INTERVAL_MS = 2000;
let lastProbeOutcome = false;

export function storageClient(): S3Client {
  if (!client) {
    client = new S3Client({
      endpoint: config.s3.endpoint,
      region: config.s3.region,
      forcePathStyle: config.s3.forcePathStyle,
      credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey },
      maxAttempts: 1,
      requestHandler: { requestTimeout: 3000 },
    });
  }
  return client;
}

export function objectKey(ownerId: string, blobId: string): string {
  return `blobs/${ownerId}/${blobId}`;
}

export async function ensureBucket(): Promise<boolean> {
  try {
    const s3 = storageClient();
    try {
      await s3.send(new HeadBucketCommand({ Bucket: config.s3.bucket }));
    } catch {
      await s3.send(new CreateBucketCommand({ Bucket: config.s3.bucket }));
      // Keep it private: the bucket is private by default on MinIO.
    }
    available = true;
    return true;
  } catch {
    available = false;
    return false;
  }
}

/** Reachability probe, cached briefly so health stays consistent between calls. */
export async function probe(): Promise<boolean> {
  const now = Date.now();
  if (now - lastProbeAt < PROBE_INTERVAL_MS && lastProbeAt !== 0) return lastProbeOutcome;
  lastProbeAt = now;
  try {
    await storageClient().send(new HeadBucketCommand({ Bucket: config.s3.bucket }));
    lastProbeOutcome = true;
  } catch {
    lastProbeOutcome = false;
  }
  return lastProbeOutcome;
}

export async function putSealedBytes(ownerId: string, blobId: string, size: number, bytes: Uint8Array): Promise<boolean> {
  try {
    await storageClient().send(new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: objectKey(ownerId, blobId),
      Body: bytes,
      ContentLength: size,
    }));
    return true;
  } catch {
    return false;
  }
}

export async function headObject(ownerId: string, blobId: string): Promise<number | null> {
  try {
    const head = await storageClient().send(new HeadObjectCommand({ Bucket: config.s3.bucket, Key: objectKey(ownerId, blobId) }));
    return head.ContentLength ?? null;
  } catch {
    return null;
  }
}

export async function getSealedBytes(ownerId: string, blobId: string): Promise<Uint8Array | null> {
  try {
    const result = await storageClient().send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: objectKey(ownerId, blobId) }));
    const bytes = await result.Body?.transformToByteArray();
    return bytes ? new Uint8Array(bytes) : null;
  } catch {
    return null;
  }
}

export async function deleteObject(ownerId: string, blobId: string): Promise<void> {
  try {
    await storageClient().send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: objectKey(ownerId, blobId) }));
  } catch {
    // A missing object on delete is fine: nothing more is held.
  }
}
