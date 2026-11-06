import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { Config } from "./config.js";

export interface Storage {
  /** True when the object was confirmed written. */
  put(key: string, bytes: Buffer, contentType: string): Promise<boolean>;
  get(key: string): Promise<{ bytes: Buffer; contentType: string } | null>;
  /** True when the object is gone (or was never there). */
  remove(key: string): Promise<boolean>;
  /** True when no object remains under the prefix. */
  removePrefix(prefix: string): Promise<boolean>;
}

class S3Storage implements Storage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: Config) {
    this.client = new S3Client({
      endpoint: config.s3.endpoint,
      region: config.s3.region,
      forcePathStyle: config.s3.forcePathStyle,
      credentials: {
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey,
      },
    });
    this.bucket = config.s3.bucket;
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<boolean> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: bytes,
          ContentType: contentType,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async get(key: string): Promise<{ bytes: Buffer; contentType: string } | null> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const chunks: Buffer[] = [];
      const stream = result.Body;
      if (stream === undefined) return null;
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as unknown as string));
      }
      return {
        bytes: Buffer.concat(chunks),
        contentType: result.ContentType ?? "application/octet-stream",
      };
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<boolean> {
    try {
      await this.client.send(new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: { Objects: [{ Key: key }] },
      }));
      return true;
    } catch {
      return false;
    }
  }

  async removePrefix(prefix: string): Promise<boolean> {
    try {
      let token: string | undefined;
      const keys: string[] = [];
      do {
        const list = await this.client.send(
          new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
        );
        for (const obj of list.Contents ?? []) {
          if (obj.Key !== undefined) keys.push(obj.Key);
        }
        token = list.IsTruncated ? list.NextContinuationToken : undefined;
      } while (token !== undefined);
      for (let i = 0; i < keys.length; i += 1000) {
        const batch = keys.slice(i, i + 1000).map((Key) => ({ Key }));
        if (batch.length === 0) continue;
        await this.client.send(
          new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: batch } }),
        );
      }
      // Confirm the prefix lists empty.
      const after = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, MaxKeys: 1 }),
      );
      return (after.Contents ?? []).length === 0;
    } catch {
      return false;
    }
  }
}

export function createStorage(config: Config): Storage {
  return new S3Storage(config);
}
