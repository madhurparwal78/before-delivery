import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3';
import { config } from './config.js';

export const s3 = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey },
});

let minioUp = false;
let probing = false;

/** Probe with a hard timeout so health always answers. */
async function timed<T>(p: Promise<T>, ms = 3000): Promise<T | null> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));
  return Promise.race([p.then((v) => v, () => null), timeout]);
}

async function probe(): Promise<boolean> {
  if (probing) return minioUp;
  probing = true;
  try {
    const res = await timed(
      s3.send(new HeadBucketCommand({ Bucket: config.s3.bucket })).then(
        () => true as const,
        (e: unknown) => e as { name?: string }
      )
    );
    if (res === null) return false;
    if (res === true) return true;
    const code = res.name;
    if (code === 'NotFound' || code === 'NoSuchBucket') {
      const created = await timed(s3.send(new CreateBucketCommand({ Bucket: config.s3.bucket })));
      return created !== null;
    }
    if (code === 'AccessDenied' || code === 'Forbidden') return true;
    return false;
  } finally {
    probing = false;
  }
}


export async function checkMinio(): Promise<boolean> {
  minioUp = await probe();
  return minioUp;
}
export function minioAvailable(): boolean { return minioUp; }

/** Availability is checked inline, from this one source. */
export async function minioPut(key: string, body: Buffer | Uint8Array, contentType: string): Promise<boolean> {
  try {
    await s3.send(new PutObjectCommand({ Bucket: config.s3.bucket, Key: key, Body: body, ContentType: contentType }));
    minioUp = true;
    return true;
  } catch {
    minioUp = false;
    return false;
  }
}

export async function minioGet(key: string): Promise<Buffer | null | false> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
    const chunks: Buffer[] = [];
    const stream = res.Body as AsyncIterable<Uint8Array>;
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    minioUp = true;
    return Buffer.concat(chunks);
  } catch (e: unknown) {
    if ((e as { name?: string }).name === 'NoSuchKey') return null;
    minioUp = false;
    return false;
  }
}

export async function putObject(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void> {
  await s3.send(new PutObjectCommand({ Bucket: config.s3.bucket, Key: key, Body: body, ContentType: contentType }));
}

export async function getObject(key: string): Promise<Buffer | null> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
    const chunks: Buffer[] = [];
    const stream = res.Body as AsyncIterable<Uint8Array>;
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  } catch (e: unknown) {
    if ((e as { name?: string }).name === 'NoSuchKey') return null;
    throw e;
  }
}

export async function deleteObject(key: string): Promise<void> {
  try { await s3.send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: key })); } catch { /* best effort */ }
}

export async function ensureBucket(): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: config.s3.bucket }));
    minioUp = true;
  } catch (e: unknown) {
    const code = (e as { name?: string }).name;
    if (code === 'AccessDenied' || code === 'Forbidden') { minioUp = true; return; }
    try {
      await s3.send(new CreateBucketCommand({ Bucket: config.s3.bucket }));
      minioUp = true;
    } catch { minioUp = false; }
  }
}
