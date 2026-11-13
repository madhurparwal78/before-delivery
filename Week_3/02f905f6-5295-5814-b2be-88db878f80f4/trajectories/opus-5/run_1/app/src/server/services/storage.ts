import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { env } from '../env';
import { ProviderDown } from '../http/errors';

const client = new S3Client({
  endpoint: env.s3.endpoint,
  region: env.s3.region,
  forcePathStyle: env.s3.forcePathStyle,
  credentials: { accessKeyId: env.s3.accessKeyId, secretAccessKey: env.s3.secretAccessKey },
});

const keyOf = (photoId: string): string => `photos/${photoId}`;

function down(error: unknown): ProviderDown {
  return new ProviderDown('storage', error instanceof Error ? error.message : 'storage failed');
}

export async function ensureBucket(): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: env.s3.bucket }));
  } catch {
    try {
      await client.send(new CreateBucketCommand({ Bucket: env.s3.bucket }));
    } catch {
      // A sibling instance may have created it, or storage is down; uploads report it.
    }
  }
}

/** Stores the uploaded bytes unchanged and reads the object back to confirm it. */
export async function storePhoto(
  photoId: string,
  bytes: Buffer,
  contentType: string,
): Promise<{ bytes: number }> {
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: env.s3.bucket,
        Key: keyOf(photoId),
        Body: bytes,
        ContentType: contentType,
        ContentLength: bytes.byteLength,
      }),
    );
    const head = await client.send(
      new HeadObjectCommand({ Bucket: env.s3.bucket, Key: keyOf(photoId) }),
    );
    if (head.ContentLength !== bytes.byteLength) {
      throw new Error('stored size does not match the upload');
    }
    return { bytes: head.ContentLength };
  } catch (error) {
    throw down(error);
  }
}

export async function confirmPhoto(photoId: string, expectedBytes: number): Promise<void> {
  try {
    const head = await client.send(
      new HeadObjectCommand({ Bucket: env.s3.bucket, Key: keyOf(photoId) }),
    );
    if (head.ContentLength !== expectedBytes) {
      throw new Error('stored size does not match the upload');
    }
  } catch (error) {
    throw down(error);
  }
}

export async function readPhoto(photoId: string): Promise<{ bytes: Buffer; contentType: string }> {
  try {
    const object = await client.send(
      new GetObjectCommand({ Bucket: env.s3.bucket, Key: keyOf(photoId) }),
    );
    if (!object.Body) throw new Error('empty object body');
    const bytes = Buffer.from(await object.Body.transformToByteArray());
    return { bytes, contentType: object.ContentType ?? 'application/octet-stream' };
  } catch (error) {
    throw down(error);
  }
}
