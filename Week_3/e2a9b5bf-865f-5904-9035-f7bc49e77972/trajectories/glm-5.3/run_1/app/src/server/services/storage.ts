// MinIO object storage through the configured S3 client (DP-15, DP-99).
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  DeleteObjectsCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import type { AppConfig } from "../config.js";

export const STORAGE_CALL_LIMIT_MS = 10_000;

export class StorageUnavailableError extends Error {
  constructor() {
    super("storage_unavailable");
  }
}

export interface StorageClient {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  head(key: string): Promise<{ size: number }>;
  list(prefix: string): Promise<readonly string[]>;
  remove(keys: readonly string[]): Promise<void>;
  isReady(): Promise<boolean>;
}

class S3Storage implements StorageClient {
  private readonly client: S3Client;

  constructor(private readonly config: AppConfig) {
    this.client = new S3Client({
      endpoint: config.s3.endpoint,
      region: config.s3.region,
      forcePathStyle: config.s3.forcePathStyle,
      credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey },
      requestHandler: { requestTimeout: STORAGE_CALL_LIMIT_MS, connectionTimeout: STORAGE_CALL_LIMIT_MS },
    });
  }

  private fail(error: unknown): never {
    // Down when unreachable, refusing, or a call passes the time limit.
    throw new StorageUnavailableError();
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new ListObjectsV2Command({ Bucket: this.config.s3.bucket, MaxKeys: 1 }));
    } catch (error) {
      if (error instanceof S3ServiceException && error.$metadata?.httpStatusCode === 404) return;
      throw this.fail(error);
    }
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({ Bucket: this.config.s3.bucket, Key: key, Body: bytes, ContentType: contentType }),
      );
    } catch (error) {
      throw this.fail(error);
    }
  }

  async get(key: string): Promise<Uint8Array> {
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.config.s3.bucket, Key: key }));
      const body = response.Body;
      if (!body) throw this.fail(new Error("empty body"));
      const chunks: Uint8Array[] = [];
      for await (const chunk of body as AsyncIterable<Uint8Array>) chunks.push(chunk);
      const total = chunks.reduce((n, c) => n + c.byteLength, 0);
      const out = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return out;
    } catch (error) {
      if (error instanceof StorageUnavailableError) throw error;
      throw this.fail(error);
    }
  }

  async head(key: string): Promise<{ size: number }> {
    try {
      const response = await this.client.send(new HeadObjectCommand({ Bucket: this.config.s3.bucket, Key: key }));
      return { size: response.ContentLength ?? 0 };
    } catch (error) {
      throw this.fail(error);
    }
  }

  async list(prefix: string): Promise<string[]> {
    try {
      const keys: string[] = [];
    let token: string | undefined;
    do {
      const response = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.config.s3.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const item of response.Contents ?? []) {
        if (item.Key) keys.push(item.Key);
      }
      token = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (token);
      return keys;
    } catch (error) {
      throw this.fail(error);
    }
  }

  async remove(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      const quiet = keys.map((key) => ({ Key: key }));
      for (let i = 0; i < quiet.length; i += 1000) {
        await this.client.send(new DeleteObjectsCommand({ Bucket: this.config.s3.bucket, Delete: { Objects: quiet.slice(i, i + 1000) } }));
      }
    } catch (error) {
      throw this.fail(error);
    }
  }

  async isReady(): Promise<boolean> {
    try {
      await this.client.send(new ListObjectsV2Command({ Bucket: this.config.s3.bucket, MaxKeys: 1 }));
      return true;
    } catch {
      return false;
    }
  }
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function makeStorage(config: AppConfig): StorageClient {
  return new S3Storage(config);
}
