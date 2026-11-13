import { createHash } from 'node:crypto';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from './config.ts';
import type { ImageInfo } from './domain.ts';

export function sniffImage(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (bytes.length >= 8) {
    if (
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
      bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a &&
      bytes[6] === 0x1a && bytes[7] === 0x0a
    ) {
      return 'image/png';
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return 'image/jpeg';
    }
    if (
      bytes.length >= 12 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 &&
      bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 &&
      bytes[10] === 0x42 && bytes[11] === 0x50
    ) {
      return 'image/webp';
    }
  }
  return null;
}

export function objectKeyFor(questionId: string, bytes: Uint8Array, contentType: string): string {
  const ext =
    contentType === 'image/png' ? 'png' : contentType === 'image/jpeg' ? 'jpg' : 'webp';
  const sha = createHash('sha256').update(bytes).digest('hex');
  return `questions/${questionId}/${sha}.${ext}`;
}

export interface StoredObject {
  key: string;
  bytes: number;
  contentType: string;
}

const s3 = new S3Client({
  region: config.s3Region,
  endpoint: config.s3Endpoint,
  forcePathStyle: config.s3ForcePathStyle,
  credentials: {
    accessKeyId: config.s3AccessKeyId,
    secretAccessKey: config.s3SecretAccessKey,
  },
  requestHandler: { requestTimeout: 4000, connectionTimeout: 2500 },
});

export async function storeObject(key: string, bytes: Uint8Array, contentType: string): Promise<StoredObject> {
  await s3.send(new PutObjectCommand({
    Bucket: config.s3Bucket,
    Key: key,
    Body: bytes,
    ContentType: contentType,
  }));
  const head = await s3.send(new HeadObjectCommand({ Bucket: config.s3Bucket, Key: key }));
  return {
    key,
    bytes: head.ContentLength ?? bytes.length,
    contentType: head.ContentType ?? contentType,
  };
}

export async function presignedGet(key: string): Promise<string> {
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: config.s3Bucket, Key: key }),
    { expiresIn: config.imageUrlTtlSeconds },
  );
}

export function imageInfo(object: StoredObject): ImageInfo {
  return {
    contentType: object.contentType as ImageInfo['contentType'],
    bytes: object.bytes,
    objectKey: object.key,
  };
}
