// MinIO is the only source of stored-object truth (DP-11, DP-29, DP-46).

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';

export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export type StorageResult<T> = { ok: true; value: T } | { ok: false; reason: 'unreachable' | 'refused' };

const TIMEOUT_MS = 5000;

export class StorageProvider {
  private readonly client: S3Client;

  constructor(private readonly config: StorageConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      requestHandler: { requestTimeout: TIMEOUT_MS, connectTimeout: TIMEOUT_MS },
    });
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
      return;
    } catch {
      // bucket missing or unreachable; try to create it
    }
    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.config.bucket }));
    } catch {
      // another instance created it first, or storage is down at boot (allowed)
    }
  }

  async probe(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<StorageResult<{ key: string }>> {
    try {
      await this.client.send(
        new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: body, ContentType: contentType }),
      );
      return { ok: true, value: { key } };
    } catch (error) {
      const code = (error as { name?: string }).name;
      if (code === 'TimeoutError' || code === 'AbortError' || code === 'ConnectTimeoutError') {
        return { ok: false, reason: 'unreachable' };
      }
      return { ok: false, reason: 'refused' };
    }
  }

  async get(key: string): Promise<StorageResult<Uint8Array>> {
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
      const chunks: Uint8Array[] = [];
      const stream = response.Body;
      if (stream === undefined) {
        return { ok: false, reason: 'refused' };
      }
      const reader = (stream as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray;
      if (typeof reader === 'function') {
        return { ok: true, value: await reader.call(stream) };
      }
      for await (const chunk of stream as AsyncIterable<Uint8Array>) {
        chunks.push(chunk as Uint8Array);
      }
      const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return { ok: true, value: merged };
    } catch (error) {
      const code = (error as { name?: string }).name;
      if (code === 'TimeoutError' || code === 'AbortError' || code === 'ConnectTimeoutError') {
        return { ok: false, reason: 'unreachable' };
      }
      return { ok: false, reason: 'refused' };
    }
  }
}

export function certificateKey(ref: string, certificateId: string): string {
  return `certificates/${ref}/${certificateId}.pdf`;
}

export function photoKey(ref: string, phase: string, serial: string, photoId: string, extension: 'jpg' | 'png'): string {
  return `photos/${ref}/${phase}/${serial}/${photoId}.${extension}`;
}
