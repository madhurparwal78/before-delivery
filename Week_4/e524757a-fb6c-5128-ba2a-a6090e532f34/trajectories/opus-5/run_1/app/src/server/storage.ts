import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { config } from './config.js';

const client = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey },
  requestHandler: { requestTimeout: 4000, connectionTimeout: 2000 },
  maxAttempts: 1,
});

export class StorageUnreachable extends Error {}

async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw new StorageUnreachable((error as Error).message);
  }
}

export async function ensureBucket(): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.s3.bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: config.s3.bucket })).catch(() => undefined);
  }
}

/** Puts the image and confirms the stored object before a photo may be kept. */
export async function putPhoto(key: string, body: Buffer, contentType: string): Promise<void> {
  await call(() => client.send(new PutObjectCommand({ Bucket: config.s3.bucket, Key: key, Body: body, ContentType: contentType })));
  const head = await call(() => client.send(new HeadObjectCommand({ Bucket: config.s3.bucket, Key: key })));
  if (head.ContentLength !== body.byteLength) throw new StorageUnreachable('stored object size differs');
}

export async function getPhoto(key: string): Promise<{ body: Buffer; contentType: string }> {
  const answer = await call(() => client.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key })));
  const chunks: Buffer[] = [];
  const stream = answer.Body as AsyncIterable<Uint8Array>;
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return { body: Buffer.concat(chunks), contentType: answer.ContentType ?? 'image/png' };
}

export async function pingStorage(): Promise<boolean> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.s3.bucket }));
    return true;
  } catch {
    return false;
  }
}
