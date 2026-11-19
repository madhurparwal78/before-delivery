import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { config } from '../config.js';

export type StorageProbe = { up: boolean; at: number };

const s3 = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
  },
  requestHandler: {
    requestTimeout: config.storageTimeoutMs,
    connectionTimeout: config.storageTimeoutMs,
  },
});

export let storageUp = false;
let lastProbe = 0;

export function storageStatus(): boolean {
  return storageUp;
}

export async function probeStorage(): Promise<boolean> {
  lastProbe = Date.now();
  try {
    await s3.send(
      new GetObjectCommand({ Bucket: config.s3.bucket, Key: 'probe/health' }),
    );
    // A 404 is fine: the bucket answered.
    storageUp = true;
  } catch (e) {
    const name = (e as { name?: string }).name ?? '';
    const code = (e as { Code?: string; code?: string }).Code ?? (e as { code?: string }).code ?? '';
    const msg = String((e as Error).message ?? '');
    if (name === 'NoSuchKey' || code === 'NoSuchKey' || code === 'NotFound' || name === 'NotFound' || /NoSuchKey|404/.test(msg)) {
      storageUp = true;
    } else {
      storageUp = false;
    }
  }
  return storageUp;
}

export function storageProbeStale(now = Date.now()): boolean {
  return now - lastProbe > config.probeIntervalMs;
}

export type PutResult = { ok: true } | { ok: false; refused: boolean };

export async function putObject(key: string, body: Buffer, contentType: string): Promise<PutResult> {
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: config.s3.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, refused: isRefusal(e) };
  }
}

export type GetResult = { ok: true; body: Buffer; contentType: string } | { ok: false; notFound: boolean; refused: boolean };

export async function getObject(key: string): Promise<GetResult> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
    const chunks: Buffer[] = [];
    if (res.Body) {
      const stream = res.Body as AsyncIterable<Uint8Array>;
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    }
    return { ok: true, body: Buffer.concat(chunks), contentType: res.ContentType ?? 'application/octet-stream' };
  } catch (e) {
    const notFound = isNotFound(e);
    return { ok: false, notFound, refused: !notFound && isRefusal(e) };
  }
}

export type DeleteResult = { ok: true; notFound: boolean } | { ok: false; refused: boolean };

export async function deleteObject(key: string): Promise<DeleteResult> {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: key }));
    return { ok: true, notFound: false };
  } catch (e) {
    const notFound = isNotFound(e);
    if (notFound) return { ok: true, notFound: true };
    return { ok: false, refused: isRefusal(e) };
  }
}

function isNotFound(e: unknown): boolean {
  const name = (e as { name?: string }).name ?? '';
  const code = (e as { Code?: string }).Code ?? '';
  return name === 'NoSuchKey' || code === 'NoSuchKey' || code === 'NotFound' || name === 'NotFound';
}

function isRefusal(e: unknown): boolean {
  const name = (e as { name?: string }).name ?? '';
  const code = (e as { Code?: string }).Code ?? '';
  const fatal = [
    'AccessDenied',
    'InvalidAccessKeyId',
    'SignatureDoesNotMatch',
    'BucketAlreadyExists',
    'MalformedXML',
    'InvalidRequest',
    'EntityTooLarge',
  ];
  if (fatal.includes(code) || fatal.includes(name)) return true;
  const msg = String((e as Error).message ?? '');
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNRESET|EHOSTUNREACH|network error|timeout/i.test(msg)) return false;
  return false;
}
