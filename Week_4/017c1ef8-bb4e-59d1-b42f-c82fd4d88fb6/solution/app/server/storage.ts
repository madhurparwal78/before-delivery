import { GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { config } from './config.js';
import { storageUnavailable } from './errors.js';

const client = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
  maxAttempts: 1,
  requestHandler: { connectionTimeout: 1500, requestTimeout: 8000 },
});

const Bucket = config.s3.bucket;

/** Health: is the bucket reachable right now? Answers within two seconds. */
export async function storageReachable(): Promise<boolean> {
  try {
    await client.send(new HeadBucketCommand({ Bucket }), { abortSignal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

/** Stores an object and confirms it by reading its metadata back. Throws the storage 503 when it cannot. */
export async function putConfirmed(key: string, body: Buffer, contentType: string): Promise<void> {
  try {
    await client.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }));
    const head = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
    if (head.ContentLength !== body.length) throw new Error('stored size differs');
  } catch {
    throw storageUnavailable();
  }
}

export async function getObject(key: string): Promise<Buffer> {
  try {
    const result = await client.send(new GetObjectCommand({ Bucket, Key: key }));
    return Buffer.from(await (result.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray());
  } catch {
    throw storageUnavailable();
  }
}
