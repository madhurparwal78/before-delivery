// MinIO object storage. The browser never receives a storage URL.

import crypto from 'node:crypto';
import {
  GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client,
} from '@aws-sdk/client-s3';

export interface StoredObject {
  key: string;
  sizeBytes: number;
  sha256: string;
}

const s3 = new S3Client({
  region: process.env.S3_REGION ?? 'us-east-1',
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  },
  // Health and status checks must answer quickly even when storage is down.
  maxAttempts: 1,
  requestHandler: {
    connectionTimeout: 2000,
    requestTimeout: 2000,
  },
});

const BUCKET = process.env.S3_BUCKET ?? 'gf-dev';

export async function ensureBucket(): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
  } catch {
    // The bucket is expected to exist or be creatable; a failure degrades
    // storage to unavailable, which the status endpoint reports.
  }
}

export async function putObject(key: string, body: Buffer | string): Promise<StoredObject> {
  const bytes = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: bytes }));
  return {
    key,
    sizeBytes: bytes.length,
    sha256: sha256Hex(bytes),
  };
}

export async function getObject(key: string): Promise<Buffer> {
  const result = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks: Buffer[] = [];
  const stream = result.Body;
  if (stream === undefined) throw new Error('empty body');
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// Storage is up when the bucket answers a head request.
export async function storageUp(): Promise<boolean> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
    return true;
  } catch {
    return false;
  }
}

export function sha256Hex(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function exportKeys(diagramId: string, exportId: string): Record<'png' | 'svg' | 'json', string> {
  return {
    png: `exports/${diagramId}/${exportId}/diagram.png`,
    svg: `exports/${diagramId}/${exportId}/diagram.svg`,
    json: `exports/${diagramId}/${exportId}/diagram.json`,
  };
}

export function importOriginalKey(diagramId: string, importId: string): string {
  return `imports/${diagramId}/${importId}/original`;
}

export function importModelKey(diagramId: string, importId: string): string {
  return `imports/${diagramId}/${importId}/model.json`;
}
