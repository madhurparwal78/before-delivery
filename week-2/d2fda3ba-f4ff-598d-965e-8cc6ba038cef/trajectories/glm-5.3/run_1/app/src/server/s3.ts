import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { config } from './config';

export interface StorageError extends Error {}

export const s3 = new S3Client({
  region: config.s3.region,
  endpoint: config.s3.endpoint,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey },
});

const BUCKET = () => config.s3.bucket;

let bucketReady: Promise<void> | undefined;
export const ensureBucket = (): Promise<void> => {
  if (!bucketReady) {
    bucketReady = (async () => {
      const { CreateBucketCommand } = await import('@aws-sdk/client-s3');
      try {
        await s3.send(new CreateBucketCommand({ Bucket: BUCKET() }));
      } catch (e) {
        const code = (e as { name?: string }).name;
        if (code !== 'BucketAlreadyOwnedByYou' && code !== 'BucketAlreadyExists') throw e;
      }
    })();
  }
  return bucketReady;
};

export const putObject = async (key: string, body: Buffer, contentType: string): Promise<void> => {
  await ensureBucket();
  await s3.send(
    new PutObjectCommand({ Bucket: BUCKET(), Key: key, Body: body, ContentType: contentType }),
  );
};

export const getObject = async (key: string): Promise<Buffer | null> => {
  await ensureBucket();
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET(), Key: key }));
    const chunks: Buffer[] = [];
    for await (const chunk of r.Body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === 'NoSuchKey') return null;
    throw e;
  }
};

export const listPrefix = async (prefix: string): Promise<string[]> => {
  await ensureBucket();
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET(), Prefix: prefix, ContinuationToken: token }));
    for (const o of r.Contents ?? []) if (o.Key) keys.push(o.Key);
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return keys;
};

export const deleteKeys = async (keys: string[]): Promise<void> => {
  while (keys.length) {
    const part = keys.splice(0, 900);
    await s3.send(
      new DeleteObjectsCommand({ Bucket: BUCKET(), Delete: { Objects: part.map((Key) => ({ Key })) } }),
    );
  }
};

export const deletePrefix = async (prefix: string): Promise<number> => {
  const keys = await listPrefix(prefix);
  if (keys.length) await deleteKeys(keys);
  return keys.length;
};
