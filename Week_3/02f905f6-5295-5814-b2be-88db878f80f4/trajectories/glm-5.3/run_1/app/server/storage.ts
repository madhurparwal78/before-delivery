import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import type { AppConfig } from "./config.js";
import { AppError } from "./errors.js";

export const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);
export const MAX_PHOTO_BYTES = 8_000_000;

// MinIO client. Photos are stored exactly as uploaded.
export class StorageClient {
  private client: S3Client;

  constructor(private cfg: AppConfig) {
    this.client = new S3Client({
      region: cfg.s3.region,
      endpoint: cfg.s3.endpoint,
      forcePathStyle: cfg.s3.forcePathStyle,
      credentials: {
        accessKeyId: cfg.s3.accessKeyId,
        secretAccessKey: cfg.s3.secretAccessKey
      }
    });
  }

  private key(photoId: string): string {
    return `photos/${photoId}`;
  }

  async put(photoId: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.cfg.s3.bucket,
        Key: this.key(photoId),
        Body: bytes,
        ContentType: contentType
      })
    );
  }

  // Confirms the object exists and returns its size. A photo counts as
  // stored only after this read-back succeeds.
  async confirm(photoId: string): Promise<boolean> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.cfg.s3.bucket, Key: this.key(photoId) })
      );
      return head.ContentLength !== undefined;
    } catch {
      return false;
    }
  }

  async get(photoId: string): Promise<{ bytes: Buffer; contentType: string } | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.cfg.s3.bucket, Key: this.key(photoId) })
      );
      if (!res.Body) return null;
      const chunks: Buffer[] = [];
      for await (const chunk of res.Body as AsyncIterable<Buffer>) {
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      return {
        bytes,
        contentType: res.ContentType || "application/octet-stream"
      };
    } catch {
      throw new AppError(503, "storage_unavailable", "Storage is unreachable.");
    }
  }

  async reachable(): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.cfg.s3.bucket, Key: "healthcheck-probe" }));
      return true;
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === "NotFound") return true;
      return name === "Forbidden" || name === "AccessDenied";
    }
  }
}
