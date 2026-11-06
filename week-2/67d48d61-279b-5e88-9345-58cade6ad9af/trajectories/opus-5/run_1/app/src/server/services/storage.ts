import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DOWNLOAD_LINK_SECONDS } from '../../shared/domain.js';
import { config } from '../env.js';

/** Plot storage could not be reached, so nothing was stored. */
export class StorageUnavailable extends Error {}

const client = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
  },
  requestHandler: { requestTimeout: 8000, connectionTimeout: 4000 },
});

export function objectKey(taskId: string, attachmentId: string, fileName: string): string {
  const safe = fileName.replace(/[^A-Za-z0-9._-]/g, '_');
  return `tasks/${taskId}/${attachmentId}/${safe}`;
}

export async function ensureBucket(): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.s3.bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: config.s3.bucket }));
  }
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: config.s3.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  } catch {
    throw new StorageUnavailable(`Plot storage would not store ${key}`);
  }
}

export async function storedSize(key: string): Promise<number | null> {
  try {
    const head = await client.send(
      new HeadObjectCommand({ Bucket: config.s3.bucket, Key: key }),
    );
    return head.ContentLength ?? null;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
      ?.httpStatusCode;
    if (status === 404) return null;
    throw new StorageUnavailable(`Plot storage would not confirm ${key}`);
  }
}

export async function removeObject(key: string): Promise<void> {
  await client
    .send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: key }))
    .catch(() => undefined);
}

/** A signed GET link that expires 60 seconds after it is issued. */
export async function signedDownload(key: string, fileName: string): Promise<string> {
  try {
    return await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: config.s3.bucket,
        Key: key,
        ResponseContentDisposition: `inline; filename="${fileName.replace(/["\\]/g, '')}"`,
      }),
      { expiresIn: DOWNLOAD_LINK_SECONDS },
    );
  } catch {
    throw new StorageUnavailable(`Plot storage would not sign ${key}`);
  }
}

export async function checkStorage(): Promise<boolean> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.s3.bucket }));
    return true;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
      ?.httpStatusCode;
    return status !== undefined && status < 500;
  }
}
