import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config.js';

let client: S3Client | null = null;

function s3(): S3Client {
  if (!client) {
    client = new S3Client({
      endpoint: config.s3.endpoint,
      region: config.s3.region,
      forcePathStyle: config.s3.forcePathStyle,
      credentials: {
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey,
      },
    });
  }
  return client;
}

export async function putObject(key: string, bytes: Buffer, contentType: string): Promise<void> {
  await s3().send(new PutObjectCommand({
    Bucket: config.s3.bucket,
    Key: key,
    Body: bytes,
    ContentType: contentType,
  }));
}

export async function getObject(key: string): Promise<Buffer> {
  const res = await s3().send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
  const chunks: Buffer[] = [];
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function probeStorage(): Promise<boolean> {
  try {
    await s3().send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: 'probe/health' }));
    return true;
  } catch (err) {
    const name = (err as { name?: string }).name ?? '';
    if (name === 'NoSuchKey') return true;
    if (name === 'NotFound') return true;
    return false;
  }
}

export { putObject as uploadBytes, getObject as downloadBytes };
