import { PutObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

// Object storage. Every stored object stays; nothing is overwritten.
export const bucket = process.env.S3_BUCKET ?? '';
const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true';

const s3 = new S3Client({
  region: process.env.S3_REGION ?? 'us-east-1',
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  },
});

export async function putObject(key: string, bytes: Uint8Array): Promise<void> {
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: bytes,
    ContentType: 'application/json',
  }));
}

export async function getObject(key: string): Promise<Uint8Array> {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks: Buffer[] = [];
  const stream = res.Body as AsyncIterable<Buffer>;
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export function bundleKey(projectSlug: string, digestHex: string): string {
  return `bundles/${projectSlug}/${digestHex}.json`;
}

export function evidenceKey(projectSlug: string, promotionId: string, snapshot: number): string {
  return `evidence/${projectSlug}/${promotionId}/${String(snapshot).padStart(3, '0')}.json`;
}
