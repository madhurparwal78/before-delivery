import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { config } from '../config.js';

export class StorageUnreachable extends Error {}

const s3 = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey },
  maxAttempts: 2,
});

export async function ensureBucket(): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: config.s3.bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: config.s3.bucket }));
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  try {
    await s3.send(
      new PutObjectCommand({ Bucket: config.s3.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  } catch (error) {
    throw new StorageUnreachable(String(error));
  }
}

export interface StoredObject {
  body: Buffer;
  contentType: string;
}

export async function getObject(key: string): Promise<StoredObject | null> {
  try {
    const reply = await s3.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
    const chunks: Buffer[] = [];
    for await (const chunk of reply.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return { body: Buffer.concat(chunks), contentType: reply.ContentType ?? 'application/octet-stream' };
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === 'NoSuchKey' || name === 'NotFound') return null;
    throw new StorageUnreachable(String(error));
  }
}
