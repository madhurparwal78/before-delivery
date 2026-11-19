import { S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import type { Config } from "./config.js";

/**
 * MinIO object storage. Each operation tries storage afresh, so service
 * resumes as soon as storage answers, with no restart.
 */
export class Storage {
  private client: S3Client;
  private bucket: string;
  gradingDown = false;

  constructor(cfg: Config) {
    this.bucket = cfg.s3Bucket;
    this.client = new S3Client({
      endpoint: cfg.s3Endpoint,
      region: cfg.s3Region,
      forcePathStyle: cfg.s3ForcePathStyle,
      credentials: {
        accessKeyId: cfg.s3AccessKeyId,
        secretAccessKey: cfg.s3SecretAccessKey,
      },
    });
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        const { CreateBucketCommand } = await import("@aws-sdk/client-s3");
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      } catch {
        // The bucket is provisioned already; if we cannot see it now we keep
        // serving and let each operation retry storage afresh.
      }
    }
  }

  private down(): boolean {
    return this.gradingDown;
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    if (this.down()) throw new StorageUnavailable();
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: bytes,
        }) as never,
      );
    } catch {
      throw new StorageUnavailable();
    }
  }

  async get(key: string): Promise<Buffer> {
    if (this.down()) throw new StorageUnavailable();
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const body = res.Body;
      if (!body) throw new StorageUnavailable();
      const chunks: Buffer[] = [];
      for await (const chunk of body as AsyncIterable<Buffer>) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch {
      throw new StorageUnavailable();
    }
  }

  async check(): Promise<boolean> {
    if (this.down()) return false;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }
}

export class StorageUnavailable extends Error {
  constructor() {
    super("storage_unavailable");
  }
}
