import {
  S3Client, CreateBucketCommand, HeadBucketCommand, CreateMultipartUploadCommand,
  UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand,
  DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListPartsCommand, DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { config } from '../config/runtime.js';
import { Readable } from 'node:stream';

const client = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey },
});

export const objectKey = (fileId: string): string => `files/${fileId}`;

let storageUp = true;
export const storageStatus = (): 'up' | 'down' => (storageUp ? 'up' : 'down');

function markDown(): void { storageUp = false; }
function markUp(): void { storageUp = true; }

export async function ensureBucket(): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.s3.bucket }));
  } catch (err) {
    const code = (err as { name?: string }).name;
    if (code === 'NotFound' || code === 'NoSuchBucket' || code === 'BadRequest') {
      await client.send(new CreateBucketCommand({ Bucket: config.s3.bucket }));
    } else {
      throw err;
    }
  }
}

export async function probeStorage(): Promise<'up' | 'down'> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.s3.bucket }));
    markUp();
  } catch {
    markDown();
  }
  return storageStatus();
}

export async function createMultipart(fileId: string, contentType: string): Promise<string> {
  try {
    const res = await client.send(new CreateMultipartUploadCommand({
      Bucket: config.s3.bucket, Key: objectKey(fileId), ContentType: contentType,
    }));
    markUp();
    if (!res.UploadId) throw new Error('no upload id');
    return res.UploadId;
  } catch (err) {
    markDown();
    throw new StorageDown();
  }
}

export class StorageDown extends Error {}

export async function uploadPart(fileId: string, uploadId: string, n: number, bytes: Buffer): Promise<number> {
  try {
    const res = await client.send(new UploadPartCommand({
      Bucket: config.s3.bucket, Key: objectKey(fileId), UploadId: uploadId,
      PartNumber: n, Body: bytes,
    }));
    markUp();
    if (!res.ETag) throw new Error('no etag');
    return n;
  } catch {
    markDown();
    throw new StorageDown();
  }
}

export async function completeMultipart(fileId: string, uploadId: string): Promise<number> {
  try {
    const parts = await client.send(new ListPartsCommand({
      Bucket: config.s3.bucket, Key: objectKey(fileId), UploadId: uploadId,
    }));
    const completed = (parts.Parts ?? []).map(p => ({ PartNumber: p.PartNumber!, ETag: p.ETag! }))
      .sort((a, b) => a.PartNumber - b.PartNumber);
    const res = await client.send(new CompleteMultipartUploadCommand({
      Bucket: config.s3.bucket, Key: objectKey(fileId), UploadId: uploadId,
      MultipartUpload: { Parts: completed },
    }));
    markUp();
    if (!res.ETag) throw new Error('incomplete');
    const head = await headObject(fileId);
    return head.size;
  } catch {
    markDown();
    throw new StorageDown();
  }
}

export async function headObject(fileId: string): Promise<{ size: number; contentType: string }> {
  const res = await client.send(new HeadObjectCommand({ Bucket: config.s3.bucket, Key: objectKey(fileId) }));
  return { size: res.ContentLength ?? 0, contentType: res.ContentType ?? 'application/octet-stream' };
}

export async function getObjectStream(fileId: string): Promise<Readable> {
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: objectKey(fileId) }));
    markUp();
    return res.Body as Readable;
  } catch {
    markDown();
    throw new StorageDown();
  }
}

export async function deleteObject(fileId: string): Promise<void> {
  try {
    await client.send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: objectKey(fileId) }));
    markUp();
  } catch {
    markDown();
    throw new StorageDown();
  }
}

export async function abortMultipart(fileId: string, uploadId: string): Promise<void> {
  try {
    await client.send(new AbortMultipartUploadCommand({
      Bucket: config.s3.bucket, Key: objectKey(fileId), UploadId: uploadId,
    }));
    markUp();
  } catch {
    markDown();
    throw new StorageDown();
  }
}

export async function deleteObjects(fileIds: string[]): Promise<void> {
  if (fileIds.length === 0) return;
  try {
    await client.send(new DeleteObjectsCommand({
      Bucket: config.s3.bucket,
      Delete: { Objects: fileIds.map(id => ({ Key: objectKey(id) })) },
    }));
    markUp();
  } catch {
    markDown();
    throw new StorageDown();
  }
}
