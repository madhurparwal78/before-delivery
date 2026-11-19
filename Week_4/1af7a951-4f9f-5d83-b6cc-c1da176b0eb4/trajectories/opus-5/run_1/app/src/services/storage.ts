import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { config } from '../config.js';
import { apiError, type ApiError } from '../http/errors.js';

export class MemoStorageUnavailableError extends Error {}

export function storageOutage(): ApiError {
  return apiError(503, 'memo_storage_unavailable');
}

const client = new S3Client({
  endpoint: config.storage.endpoint,
  region: config.storage.region,
  forcePathStyle: config.storage.forcePathStyle,
  credentials: {
    accessKeyId: config.storage.accessKeyId,
    secretAccessKey: config.storage.secretAccessKey,
  },
  maxAttempts: 1,
  requestHandler: { requestTimeout: 10_000, connectionTimeout: 5_000 },
});

export function memoKey(enrollmentId: string, entryId: string): string {
  return `memos/${enrollmentId}/${entryId}`;
}

export async function ensureBucket(): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.storage.bucket }));
  } catch {
    try {
      await client.send(new CreateBucketCommand({ Bucket: config.storage.bucket }));
    } catch {
      return;
    }
  }
}

export async function putMemo(
  key: string,
  bytes: Buffer,
  contentType: string,
  durationMs: number,
): Promise<void> {
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: config.storage.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
        Metadata: { 'duration-ms': String(durationMs) },
      }),
    );
  } catch {
    throw new MemoStorageUnavailableError('MinIO is unreachable');
  }
}

export async function getMemo(key: string): Promise<Buffer> {
  try {
    const result = await client.send(
      new GetObjectCommand({ Bucket: config.storage.bucket, Key: key }),
    );
    const body = result.Body;
    if (body === undefined) throw new Error('Empty memo body');
    return Buffer.from(await body.transformToByteArray());
  } catch {
    throw new MemoStorageUnavailableError('MinIO is unreachable');
  }
}
