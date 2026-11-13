import { config } from './config.js';
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

export class StorageDown extends Error {}

export const s3 = new S3Client({
  region: config.s3.region,
  endpoint: config.s3.endpoint,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
  },
});

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  try {
    await s3.send(new PutObjectCommand({ Bucket: config.s3.bucket, Key: key, Body: body, ContentType: contentType }));
  } catch (err) {
    throw new StorageDown(String(err));
  }
}

export async function getObject(key: string): Promise<{ body: Buffer; contentType?: string } | null> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
    const chunks: Buffer[] = [];
    const stream = res.Body as AsyncIterable<Uint8Array>;
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return { body: Buffer.concat(chunks), contentType: res.ContentType };
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === 'NoSuchKey') return null;
    throw new StorageDown(String(err));
  }
}

export async function deleteObject(key: string): Promise<void> {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: key }));
  } catch (err) {
    throw new StorageDown(String(err));
  }
}
