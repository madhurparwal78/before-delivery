import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import type { Config } from "../config.js";

export class StorageUnavailable extends Error {}

export class Storage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(cfg: Config["s3"]) {
    this.bucket = cfg.bucket;
    this.client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      forcePathStyle: cfg.forcePathStyle,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      requestHandler: { requestTimeout: 5000, connectionTimeout: 3000 },
    });
  }

  private async run<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch {
      throw new StorageUnavailable("storage unreachable");
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.run(() =>
      this.client.send(
        new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
      ),
    );
  }

  async get(key: string): Promise<Buffer> {
    const result = await this.run(() => this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key })));
    const chunks: Buffer[] = [];
    const stream = result.Body as AsyncIterable<Uint8Array>;
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    await this.run(() => this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })));
  }

  async deletePrefix(prefix: string): Promise<void> {
    const list = await this.run(() =>
      this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix })),
    );
    const keys = (list.Contents ?? []).map((o) => o.Key).filter((k): k is string => Boolean(k));
    await Promise.all(keys.map((key) => this.run(() => this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })))));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.get(key);
      return true;
    } catch (error) {
      if (error instanceof StorageUnavailable) {
        throw error;
      }
      return false;
    }
  }
}
