import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { config, LIMITS } from '../server/config.js';

/** Thrown when object storage cannot be reached, refuses a write, or times out. */
export class StorageUnavailableError extends Error {}

const client = new S3Client({
  endpoint: config.storage.endpoint,
  region: config.storage.region,
  forcePathStyle: config.storage.forcePathStyle,
  credentials: {
    accessKeyId: config.storage.accessKeyId,
    secretAccessKey: config.storage.secretAccessKey,
  },
  requestHandler: { requestTimeout: LIMITS.providerTimeoutMs, connectionTimeout: 2_000 },
  maxAttempts: 1,
});

function unavailable(action: string, cause: unknown): StorageUnavailableError {
  return new StorageUnavailableError(`Storage could not ${action}`, { cause });
}

export async function ensureBucket(): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.storage.bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: config.storage.bucket }));
  }
}

export async function probe(timeoutMs: number): Promise<boolean> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.storage.bucket }), {
      requestTimeout: timeoutMs,
    });
    return true;
  } catch {
    return false;
  }
}

/** Writes the bytes exactly as given and only returns once storage acknowledges. */
export async function putObject(
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: config.storage.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: body.byteLength,
      }),
    );
  } catch (cause) {
    throw unavailable(`store ${key}`, cause);
  }
}

export type ObjectPresence = 'present' | 'absent';

export async function objectPresence(key: string): Promise<ObjectPresence> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: config.storage.bucket, Key: key }));
    return 'present';
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404 || status === 403) return 'absent';
    throw unavailable(`look up ${key}`, error);
  }
}

export async function getObject(key: string): Promise<Uint8Array> {
  try {
    const result = await client.send(
      new GetObjectCommand({ Bucket: config.storage.bucket, Key: key }),
    );
    if (result.Body === undefined) throw new Error('no body');
    return await result.Body.transformToByteArray();
  } catch (cause) {
    throw unavailable(`read ${key}`, cause);
  }
}
