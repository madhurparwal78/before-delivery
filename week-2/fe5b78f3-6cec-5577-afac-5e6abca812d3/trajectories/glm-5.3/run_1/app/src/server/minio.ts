import {
  S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';

// MinIO stores every e-ticket PDF, byte for byte as first stored.

export const s3 = new S3Client({
  region: process.env.S3_REGION ?? 'us-east-1',
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  },
});

const BUCKET = process.env.S3_BUCKET ?? '';

export function ticketKey(pnr: string, version: number, kind: string): string {
  return `tickets/${pnr}/v${version}-${kind}.pdf`;
}

export class StorageDown extends Error {}

export async function putTicket(key: string, bytes: Uint8Array): Promise<string> {
  try {
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: bytes,
      ContentType: 'application/pdf',
    }));
    return createHash('md5').update(bytes).digest('hex');
  } catch {
    throw new StorageDown();
  }
}

export async function getTicket(key: string): Promise<{ bytes: Buffer; etag: string } | null> {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const bytes = Buffer.from(await r.Body!.transformToByteArray());
    return { bytes, etag: (r.ETag ?? '').replace(/"/g, '') };
  } catch (e) {
    const name = (e as { name?: string }).name ?? '';
    if (name === 'NoSuchKey' || name === 'NotFound') return null;
    throw new StorageDown();
  }
}

export async function headTicket(key: string): Promise<{ etag: string } | null> {
  try {
    const r = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return { etag: (r.ETag ?? '').replace(/"/g, '') };
  } catch (e) {
    const name = (e as { name?: string }).name ?? '';
    if (name === 'NotFound' || name === 'NoSuchKey') return null;
    throw new StorageDown();
  }
}
