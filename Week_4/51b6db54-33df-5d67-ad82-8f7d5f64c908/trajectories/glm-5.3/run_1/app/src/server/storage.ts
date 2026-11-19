import {
  S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand,
  CreateBucketCommand, HeadBucketCommand
} from '@aws-sdk/client-s3';

export interface StoredFile { name: string; size: number; sha256: string }

let client: S3Client | null = null;
let bucketChecked = false;

export class StorageDown extends Error {}

function s3(): S3Client {
  if (!client) {
    const forcePath = String(process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true';
    client = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION ?? 'us-east-1',
      forcePathStyle: forcePath,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? ''
      }
    });
  }
  return client;
}

export async function ensureBucket(): Promise<void> {
  if (bucketChecked) return;
  try {
    await s3().send(new CreateBucketCommand({ Bucket: process.env.S3_BUCKET }));
  } catch {
    // bucket already exists or cannot be created now; object ops will decide
  }
  bucketChecked = true;
}

/** Put an object and verify the stored size and checksum match what we sent. */
export async function putVerified(key: string, data: Buffer, shaHex: string): Promise<StoredFile> {
  try {
    await s3().send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: data }));
    const head = await s3().send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
    const size = Number(head.ContentLength);
    if (size !== data.length) {
      await s3().send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
      throw new StorageDown('size mismatch after put');
    }
    const got = await s3().send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
    const bytes = Buffer.from(await got.Body!.transformToByteArray());
    const crypto = await import('node:crypto');
    const sha = crypto.createHash('sha256').update(bytes).digest('hex');
    if (sha !== shaHex) {
      await s3().send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
      throw new StorageDown('checksum mismatch after put');
    }
    return { name: key.split('/').pop()!, size, sha256: sha };
  } catch (e) {
    if (e instanceof StorageDown) throw e;
    throw new StorageDown('storage unreachable');
  }
}

export async function getObject(key: string): Promise<Buffer> {
  try {
    const got = await s3().send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
    return Buffer.from(await got.Body!.transformToByteArray());
  } catch {
    throw new StorageDown('storage unreachable');
  }
}

export async function deleteObject(key: string): Promise<void> {
  try {
    await s3().send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
  } catch {
    throw new StorageDown('storage unreachable');
  }
}

export async function storageHealthy(): Promise<boolean> {
  try {
    await s3().send(new HeadBucketCommand({ Bucket: process.env.S3_BUCKET }));
    return true;
  } catch {
    return false;
  }
}
