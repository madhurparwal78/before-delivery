import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, CreateBucketCommand } from "@aws-sdk/client-s3";
import type { AppConfig } from "./config.js";

export interface StoredObject { body: Buffer; exists: true }
export type StoredBytes = StoredObject | { exists: false };

export class Storage {
  client: S3Client;
  cfg: AppConfig;
  ok: boolean;

  constructor(cfg: AppConfig) {
    this.cfg = cfg;
    this.client = new S3Client({
      region: cfg.s3.region,
      endpoint: cfg.s3.endpoint,
      forcePathStyle: cfg.s3.forcePathStyle,
      credentials: { accessKeyId: cfg.s3.accessKeyId, secretAccessKey: cfg.s3.secretAccessKey },
      requestHandler: { requestTimeout: 3000 },
    });
    this.ok = false;
  }

  async check(): Promise<boolean> {
    // The bucket is created on demand so a fresh empty bucket works on first start.
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.cfg.s3.bucket, Key: "healthcheck-probe" }));
      this.ok = true;
    } catch (e) {
      const name = (e as { name?: string }).name ?? "";
      if (name === "NotFound" || name === "NoSuchKey" || name === "404") {
        this.ok = true;
      } else {
        try {
          await this.client.send(new CreateBucketCommand({ Bucket: this.cfg.s3.bucket }));
          this.ok = true;
        } catch (createErr) {
          const createName = (createErr as { name?: string }).name ?? "";
          this.ok = createName === "BucketAlreadyOwnedByYou";
        }
      }
    }
    return this.ok;
  }

  async put(key: string, body: Buffer, contentType = "application/pdf"): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.cfg.s3.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }));
  }

  async get(key: string): Promise<StoredBytes> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.s3.bucket, Key: key }));
      const bytes = await res.Body?.transformToByteArray();
      if (!bytes) throw new Error("empty body");
      return { exists: true, body: Buffer.from(bytes) };
    } catch (e) {
      const name = (e as { name?: string }).name ?? "";
      if (name === "NotFound" || name === "NoSuchKey") return { exists: false };
      throw e;
    }
  }

  async head(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.cfg.s3.bucket, Key: key }));
      return true;
    } catch (e) {
      const name = (e as { name?: string }).name ?? "";
      if (name === "NotFound" || name === "NoSuchKey") return false;
      throw e;
    }
  }
}
