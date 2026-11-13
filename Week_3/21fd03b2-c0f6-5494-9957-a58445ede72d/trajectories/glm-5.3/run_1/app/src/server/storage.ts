import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { AppError } from './errors';

const endpoint = process.env.S3_ENDPOINT ?? '';
const bucket = process.env.S3_BUCKET ?? '';

let client: S3Client | null = null;
let available = true;
let lastCheck = 0;

function s3(): S3Client {
  if (!client) {
    client = new S3Client({
      endpoint,
      region: process.env.S3_REGION ?? 'us-east-1',
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
      },
      requestHandler: { requestTimeout: 2000, connectionTimeout: 1500 },
    });
  }
  return client;
}

export function storageBucket(): string {
  return bucket;
}

export function storageUnavailable(): AppError {
  return new AppError(503, 'storage_unavailable', 'File storage is unreachable.');
}

export async function storagePut(key: string, bytes: Buffer, contentType: string): Promise<void> {
  try {
    await s3().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: contentType }));
    available = true;
  } catch (e) {
    available = false;
    throw storageUnavailable();
  } finally {
    lastCheck = Date.now();
  }
}

export async function storageGet(key: string): Promise<Buffer> {
  try {
    const result = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = result.Body;
    if (!body) throw new Error('empty body');
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Buffer>) chunks.push(chunk);
    available = true;
    return Buffer.concat(chunks);
  } catch (e) {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
    const status = err?.$metadata?.httpStatusCode;
    if (status === 404 || err?.name === 'NoSuchKey') {
      lastCheck = Date.now();
      throw new AppError(404, 'not_found', "We couldn't find that file.");
    }
    available = false;
    throw storageUnavailable();
  } finally {
    lastCheck = Date.now();
  }
}

export async function storageStatus(): Promise<'ok' | 'down'> {
  const age = Date.now() - lastCheck;
  if (available && age < 5000) return 'ok';
  try {
    await s3().send(new GetObjectCommand({ Bucket: bucket, Key: 'rw-healthcheck' }));
    available = true;
  } catch (e) {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
    const status = err?.$metadata?.httpStatusCode;
    if (status === 404 || err?.name === 'NoSuchKey') {
      available = true;
    } else {
      available = false;
    }
  }
  lastCheck = Date.now();
  return available ? 'ok' : 'down';
}
