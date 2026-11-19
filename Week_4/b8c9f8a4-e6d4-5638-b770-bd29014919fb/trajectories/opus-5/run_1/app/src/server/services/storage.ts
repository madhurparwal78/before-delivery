import { createHash } from 'node:crypto';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { config } from '../config';
import { refuse } from '../domain/errors';

const client = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey },
});

export const storageUnavailable = (): never => {
  throw refuse(503, 'storage_unavailable', 'The file store is not answering');
};

export const objectKeys = {
  original: (carId: string, uploadId: string): string => `originals/${carId}/${uploadId}`,
  derivative: (carId: string, uploadId: string): string => `derivatives/${carId}/${uploadId}.jpg`,
  report: (carId: string, version: number): string => `reports/${carId}/v${version}.pdf`,
  handover: (carId: string): string => `handover/${carId}.pdf`,
} as const;

/**
 * Stores one object and then asks the store to confirm it, by reading back the
 * object's size and the hash it holds. Nothing is reported as stored until this
 * passes.
 */
export const putConfirmed = async (key: string, bytes: Buffer, contentType: string): Promise<string> => {
  const digest = createHash('sha256').update(bytes).digest();
  await client.send(
    new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
      Body: bytes,
      ContentType: contentType,
      ChecksumSHA256: digest.toString('base64'),
    }),
  );

  const head = await client.send(
    new HeadObjectCommand({ Bucket: config.s3.bucket, Key: key, ChecksumMode: 'ENABLED' }),
  );
  if (head.ContentLength !== bytes.length) throw new Error(`The store reported ${head.ContentLength} bytes for ${key}`);
  if (head.ChecksumSHA256 !== undefined && head.ChecksumSHA256 !== digest.toString('base64')) {
    throw new Error(`The store reported a different hash for ${key}`);
  }
  return digest.toString('hex');
};

export const removeObject = async (key: string): Promise<void> => {
  await client.send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: key }));
};

export interface StoredObject {
  bytes: Buffer;
  contentType: string;
}

export const getObject = async (key: string): Promise<StoredObject> => {
  const result = await client.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
  if (result.Body === undefined) throw new Error(`The store returned no body for ${key}`);
  const chunks: Buffer[] = [];
  for await (const chunk of result.Body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
  return { bytes: Buffer.concat(chunks), contentType: result.ContentType ?? 'application/octet-stream' };
};

export const ensureBucket = async (): Promise<void> => {
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.s3.bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: config.s3.bucket }));
  }
};

export const storageReachable = async (): Promise<boolean> => {
  try {
    await ensureBucket();
    return true;
  } catch {
    return false;
  }
};
