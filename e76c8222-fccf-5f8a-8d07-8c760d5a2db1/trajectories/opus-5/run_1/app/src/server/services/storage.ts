import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { config } from '../env';
import { ApiError } from '../http/errors';

const client = new S3Client({
  endpoint: config.storage.endpoint,
  region: config.storage.region,
  forcePathStyle: config.storage.forcePathStyle,
  credentials: {
    accessKeyId: config.storage.accessKeyId,
    secretAccessKey: config.storage.secretAccessKey,
  },
  maxAttempts: 1,
  requestHandler: { connectionTimeout: 2000, requestTimeout: 4000 },
});

const unavailable = (): ApiError => new ApiError('storage_unavailable');

export interface StoredObject {
  body: Buffer;
  contentType: string;
}

export async function ensureBucket(): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.storage.bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: config.storage.bucket }));
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: config.storage.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  } catch {
    throw unavailable();
  }
}

export async function getObject(key: string): Promise<StoredObject> {
  try {
    const result = await client.send(
      new GetObjectCommand({ Bucket: config.storage.bucket, Key: key }),
    );
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) throw unavailable();
    return {
      body: Buffer.from(bytes),
      contentType: result.ContentType ?? 'application/octet-stream',
    };
  } catch {
    throw unavailable();
  }
}

export async function deleteObject(key: string): Promise<void> {
  await client.send(new DeleteObjectCommand({ Bucket: config.storage.bucket, Key: key }));
}

export async function storageReachable(timeoutMs: number): Promise<boolean> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.storage.bucket }), {
      abortSignal: abort.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export const prepObjectKey = (
  orgId: string,
  requestId: string,
  fileId: string,
  filename: string,
): string => `prep/${orgId}/${requestId}/${fileId}/${filename}`;

export const credentialScanKey = (
  interpreterId: string,
  credentialId: string,
  filename: string,
): string => `credentials/${interpreterId}/${credentialId}/${filename}`;

export const timesheetPdfKey = (requestId: string, timesheetId: string): string =>
  `timesheets/${requestId}/${timesheetId}.pdf`;
