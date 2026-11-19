import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { config } from './config';
import { storageUnavailable } from '../shared/errors';

const client = new S3Client({
  endpoint: config.storage.endpoint,
  region: config.storage.region,
  forcePathStyle: config.storage.forcePathStyle,
  credentials: {
    accessKeyId: config.storage.accessKeyId,
    secretAccessKey: config.storage.secretAccessKey,
  },
  requestHandler: { requestTimeout: 2000, connectionTimeout: 2000 },
});

export async function ensureBucket(): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.storage.bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: config.storage.bucket })).catch(() => undefined);
  }
}

export async function storageReachable(): Promise<boolean> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.storage.bucket }));
    return true;
  } catch {
    return false;
  }
}

/** Stores bytes and confirms the stored size, or throws `storage_unavailable`. */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  try {
    await client.send(
      new PutObjectCommand({ Bucket: config.storage.bucket, Key: key, Body: body, ContentType: contentType }),
    );
    const head = await client.send(new HeadObjectCommand({ Bucket: config.storage.bucket, Key: key }));
    if (head.ContentLength !== body.length) throw new Error('size mismatch');
  } catch {
    throw storageUnavailable();
  }
}

export async function getObject(key: string): Promise<Buffer> {
  try {
    const answer = await client.send(new GetObjectCommand({ Bucket: config.storage.bucket, Key: key }));
    const body = answer.Body;
    if (!body) throw new Error('empty body');
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  } catch {
    throw storageUnavailable();
  }
}
