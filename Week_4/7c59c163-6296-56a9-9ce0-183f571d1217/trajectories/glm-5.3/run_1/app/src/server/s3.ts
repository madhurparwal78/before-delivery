import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfig } from './config.js';

export function createS3Client(config: AppConfig): S3Client {
  return new S3Client({
    region: config.s3.region,
    endpoint: config.s3.endpoint,
    forcePathStyle: config.s3.forcePathStyle,
    credentials: {
      accessKeyId: config.s3.accessKeyId,
      secretAccessKey: config.s3.secretAccessKey,
    },
  });
}

export async function presignGet(client: S3Client, bucket: string, key: string, expiresIn: number): Promise<string> {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(client, command, { expiresIn });
}

export async function putObjectBytes(client: S3Client, bucket: string, key: string, body: Uint8Array, contentType: string): Promise<void> {
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType });
  await client.send(command);
}

export async function getObjectBytes(client: S3Client, bucket: string, key: string): Promise<Uint8Array> {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const res = await client.send(command);
  const bytes = await res.Body?.transformToByteArray();
  return bytes ?? new Uint8Array(0);
}

export { S3Client, GetObjectCommand, PutObjectCommand };


