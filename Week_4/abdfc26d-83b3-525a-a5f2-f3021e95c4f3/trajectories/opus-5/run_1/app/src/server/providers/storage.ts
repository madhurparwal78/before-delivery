import { createHash } from 'node:crypto';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config.js';

const client = new S3Client({
  endpoint: config.s3Endpoint,
  region: config.s3Region,
  forcePathStyle: config.s3ForcePathStyle,
  credentials: {
    accessKeyId: config.s3AccessKeyId,
    secretAccessKey: config.s3SecretAccessKey,
  },
});

export class StorageUnavailable extends Error {
  constructor(cause: unknown) {
    super('File storage is unreachable');
    this.name = 'StorageUnavailable';
    this.cause = cause;
  }
}

async function wrap<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw new StorageUnavailable(error);
  }
}

export const objectKeys = {
  pieceAsset: (slug: string, assetId: string, filename: string): string =>
    `pieces/${slug}/assets/${assetId}/${filename}`,
  renderExport: (renderId: string, format: 'mp4' | 'webm'): string =>
    `renders/${renderId}/export.${format}`,
  invoice: (year: number, invoiceNumber: string): string => `invoices/${year}/${invoiceNumber}.pdf`,
  creditNote: (year: number, creditNoteNumber: string): string =>
    `credit-notes/${year}/${creditNoteNumber}.pdf`,
  statement: (period: string, creatorId: string): string => `statements/${period}/${creatorId}.pdf`,
};

/** The bucket stays private; it is created once if missing. */
export async function ensureBucket(): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.s3Bucket }));
  } catch {
    await client
      .send(new CreateBucketCommand({ Bucket: config.s3Bucket }))
      .catch(() => undefined);
  }
}

export async function putObject(
  key: string,
  bytes: Buffer,
  contentType: string,
): Promise<void> {
  await wrap(() =>
    client.send(
      new PutObjectCommand({
        Bucket: config.s3Bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }),
    ),
  );
}

/** Reads the stored object back so its checksum can be compared with the provider's. */
export async function storedObjectSha256(key: string): Promise<string> {
  return wrap(async () => {
    const response = await client.send(
      new GetObjectCommand({ Bucket: config.s3Bucket, Key: key }),
    );
    const body = response.Body;
    if (!body) throw new Error(`Object ${key} came back empty`);
    const hash = createHash('sha256');
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      hash.update(chunk);
    }
    return hash.digest('hex');
  });
}

export async function getObject(key: string): Promise<Buffer> {
  return wrap(async () => {
    const response = await client.send(
      new GetObjectCommand({ Bucket: config.s3Bucket, Key: key }),
    );
    const body = response.Body;
    if (!body) throw new Error(`Object ${key} came back empty`);
    const chunks: Uint8Array[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  });
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: config.s3Bucket, Key: key }));
    return true;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404 || status === 403) return false;
    throw new StorageUnavailable(error);
  }
}

export interface PresignedDownload {
  readonly url: string;
  readonly expiresIn: number;
}

/** A fresh short-lived link that downloads the object rather than displaying it. */
export async function presignDownload(key: string, filename: string): Promise<PresignedDownload> {
  const url = await wrap(() =>
    getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: config.s3Bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${filename}"`,
      }),
      { expiresIn: config.presignSeconds },
    ),
  );
  return { url, expiresIn: config.presignSeconds };
}

export async function probeStorage(): Promise<boolean> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.s3Bucket }));
    return true;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    return typeof status === 'number' && status < 500;
  }
}
