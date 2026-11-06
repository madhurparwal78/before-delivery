import {
  S3Client, PutObjectCommand, GetObjectCommand, AbortMultipartUploadCommand,
  ListMultipartUploadsCommand, DeleteObjectsCommand, ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import type { Env } from '../env.ts';

export interface Storage {
  putObject(key: string, data: Buffer, contentType: string): Promise<void>;
  getObject(key: string): Promise<{ data: Buffer; contentType: string }>;
  abortUploadsUnder(prefix: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
  health(): Promise<boolean>;
}

export function createStorage(env: Env): Storage {
  const client = new S3Client({
    region: env.s3.region,
    endpoint: env.s3.endpoint,
    forcePathStyle: env.s3.forcePathStyle,
    credentials: { accessKeyId: env.s3.accessKeyId, secretAccessKey: env.s3.secretAccessKey },
    requestHandler: { requestTimeout: 5000 },
  });
  const bucket = env.s3.bucket;

  return {
    async putObject(key: string, data: Buffer, contentType: string): Promise<void> {
      // Objects are written once and never rewritten, and bodies are capped at
      // the published limit, so a single put is the right tool.
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
      }));
    },
    async getObject(key: string): Promise<{ data: Buffer; contentType: string }> {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const chunks: Buffer[] = [];
      if (result.Body) {
        for await (const chunk of result.Body as AsyncIterable<Buffer>) {
          chunks.push(chunk);
        }
      }
      return {
        data: Buffer.concat(chunks),
        contentType: result.ContentType ?? 'application/octet-stream',
      };
    },
    async abortUploadsUnder(prefix: string): Promise<void> {
      const listed = await client.send(new ListMultipartUploadsCommand({ Bucket: bucket, Prefix: prefix }));
      const uploads = listed.Uploads ?? [];
      for (const upload of uploads) {
        if (upload.Key) {
          await client.send(new AbortMultipartUploadCommand({
            Bucket: bucket,
            Key: upload.Key,
            UploadId: upload.UploadId,
          }));
        }
      }
    },
    async deleteObject(key: string): Promise<void> {
      await client.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: [{ Key: key }] },
      }));
    },
    async health(): Promise<boolean> {
      try {
        await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
        return true;
      } catch {
        return false;
      }
    },
  };
}

