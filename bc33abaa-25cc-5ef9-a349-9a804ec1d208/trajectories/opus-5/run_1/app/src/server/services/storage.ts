import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { config } from '../config';
import { fail } from '../http/errors';

const client = new S3Client({
  region: config.s3.region,
  endpoint: config.s3.endpoint,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
  },
  maxAttempts: 1,
  requestHandler: { requestTimeout: 5_000, connectionTimeout: 2_000 },
});

let bucketReady = false;

function httpStatus(error: unknown): number | undefined {
  if (error !== null && typeof error === 'object' && '$metadata' in error) {
    const metadata = (error as { $metadata?: { httpStatusCode?: number } }).$metadata;
    return metadata?.httpStatusCode;
  }
  return undefined;
}

/** Any failure that is not a plain object-level answer means the store is unreachable. */
function asStorageError(error: unknown): never {
  const status = httpStatus(error);
  if (status === 404 || status === 403) {
    throw new MissingObjectError();
  }
  bucketReady = false;
  throw fail.serviceDown('file_storage');
}

export class MissingObjectError extends Error {
  constructor() {
    super('object not found');
  }
}

async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.s3.bucket }));
    bucketReady = true;
    return;
  } catch (error) {
    const status = httpStatus(error);
    if (status !== 404 && status !== 403 && status !== undefined) {
      throw fail.serviceDown('file_storage');
    }
    if (status === undefined) throw fail.serviceDown('file_storage');
  }
  try {
    await client.send(new CreateBucketCommand({ Bucket: config.s3.bucket }));
    bucketReady = true;
  } catch (error) {
    const status = httpStatus(error);
    if (status === 409) {
      bucketReady = true;
      return;
    }
    throw fail.serviceDown('file_storage');
  }
}

export const storageKeys = {
  snapshot: (workspaceId: string, sceneId: string, versionId: string): string =>
    `ws/${workspaceId}/scenes/${sceneId}/versions/${versionId}/snapshot.json`,
  thumbnail: (workspaceId: string, sceneId: string, versionId: string): string =>
    `ws/${workspaceId}/scenes/${sceneId}/versions/${versionId}/thumbnail.png`,
  asset: (workspaceId: string, assetId: string): string => `ws/${workspaceId}/assets/${assetId}`,
  published: (workspaceId: string, embedId: string): string =>
    `ws/${workspaceId}/published/${embedId}/scene.json`,
  exportBundle: (workspaceId: string, exportId: string): string =>
    `ws/${workspaceId}/exports/${exportId}.zip`,
  invoice: (workspaceId: string, invoiceId: string): string =>
    `ws/${workspaceId}/invoices/${invoiceId}.pdf`,
};

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await ensureBucket();
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: config.s3.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  } catch (error) {
    asStorageError(error);
  }
}

export async function deleteObject(key: string): Promise<void> {
  try {
    await client.send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: key }));
  } catch (error) {
    asStorageError(error);
  }
}

export async function getObject(key: string): Promise<Buffer> {
  await ensureBucket();
  try {
    const result = await client.send(
      new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }),
    );
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) throw new MissingObjectError();
    return Buffer.from(bytes);
  } catch (error) {
    if (error instanceof MissingObjectError) throw error;
    if (error !== null && typeof error === 'object' && (error as { name?: string }).name === 'NoSuchKey') {
      throw new MissingObjectError();
    }
    asStorageError(error);
  }
}

export async function storageReachable(): Promise<boolean> {
  try {
    await ensureBucket();
    return true;
  } catch {
    return false;
  }
}
