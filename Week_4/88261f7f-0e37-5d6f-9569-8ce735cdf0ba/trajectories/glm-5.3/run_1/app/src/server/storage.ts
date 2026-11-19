import { S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { config } from './config.js';
import type { Readable } from 'node:stream';

export const s3 = new S3Client({
  region: config.s3.region,
  endpoint: config.s3.endpoint,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey
  }
});

export async function ensureBucket(): Promise<boolean> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: config.s3.bucket }));
    return true;
  } catch {
    return false;
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await s3.send(new PutObjectCommand({ Bucket: config.s3.bucket, Key: key, Body: body, ContentType: contentType }));
}

export async function getObject(key: string): Promise<Buffer> {
  const res = await s3.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
  const stream = res.Body as Readable;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    await s3.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

export const invoiceKey = (hotelId: string, number: string) => `invoices/${hotelId}/${number}.pdf`;
export const photoKey = (hotelId: string, stayId: string) => `id-photos/${hotelId}/${stayId}`;
