import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { config } from '../config.js';
import { guard, markService } from './availability.js';

export const s3 = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey },
});

export async function ensureBucket(): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: config.s3.bucket }));
    markService('storage', true);
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: config.s3.bucket }));
    markService('storage', true);
  }
}

/** Put an object and confirm it reads back with the expected length (queue stage rule). */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await guard('storage', async () => {
    await s3.send(new PutObjectCommand({ Bucket: config.s3.bucket, Key: key, Body: body, ContentType: contentType }));
    const head = await s3.send(new HeadObjectCommand({ Bucket: config.s3.bucket, Key: key }));
    if (Number(head.ContentLength) !== body.length) throw new Error('storage length mismatch');
  });
}

export async function getObject(key: string): Promise<Buffer> {
  return guard('storage', async () => {
    const result = await s3.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
    const body = await result.Body?.transformToByteArray();
    if (body === undefined) throw new Error('storage empty body');
    return Buffer.from(body);
  });
}

export async function objectExists(key: string): Promise<boolean> {
  return guard('storage', async () => {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: config.s3.bucket, Key: key }));
      return true;
    } catch (err) {
      if ((err as { name?: string }).name === 'NotFound') return false;
      throw err;
    }
  });
}

export async function pingStorage(): Promise<void> {
  await s3.send(new HeadBucketCommand({ Bucket: config.s3.bucket }));
}

export const originalKey = (checksum: string): string => `originals/${checksum}`;
export const derivativeKey = (slug: string, revision: number, name: 'model.glb' | 'model.stl' | 'preview.png'): string =>
  `derivatives/${slug}/r${revision}/${name}`;
export const textureSetKey = (checksum: string): string => `texture-sets/${checksum}`;
