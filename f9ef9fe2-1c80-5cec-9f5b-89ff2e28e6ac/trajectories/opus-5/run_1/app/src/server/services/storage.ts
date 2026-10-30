import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { env } from '../env.js';

const client = new S3Client({
  endpoint: env.storage.endpoint,
  region: env.storage.region,
  forcePathStyle: env.storage.forcePathStyle,
  credentials: {
    accessKeyId: env.storage.accessKeyId,
    secretAccessKey: env.storage.secretAccessKey,
  },
});

/** The uploaded file name never forms part of the key. */
export function documentStorageKey(kitchenId: string, memberId: string, documentId: string): string {
  return `documents/${kitchenId}/${memberId}/${documentId}`;
}

export async function putDocumentFile(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: env.storage.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function getDocumentFile(key: string): Promise<Buffer> {
  const result = await client.send(
    new GetObjectCommand({ Bucket: env.storage.bucket, Key: key }),
  );
  if (!result.Body) throw new Error('Object storage returned no body');
  return Buffer.from(await result.Body.transformToByteArray());
}

export async function probeStorage(): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: env.storage.bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: env.storage.bucket }));
  }
}
