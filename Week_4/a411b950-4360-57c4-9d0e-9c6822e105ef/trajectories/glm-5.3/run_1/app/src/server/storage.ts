import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { AppConfig } from "./config.js";

/**
 * MinIO access. The bucket stays private; every byte reaches browsers through
 * the app (DP: Services/MinIO).
 */
export class StorageUnavailable extends Error {
  constructor(public readonly detail: string) {
    super(`Storage unreachable: ${detail}`);
  }
}

export class Storage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly playability = new Map<string, { at: number; playable: boolean }>();
  private readonly playabilityTtlMs = 10000;

  constructor(private readonly config: AppConfig) {
    this.client = new S3Client({
      region: config.s3.region,
      endpoint: config.s3.endpoint,
      forcePathStyle: config.s3.forcePathStyle,
      credentials: {
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey,
      },
    });
    this.bucket = config.s3.bucket;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
      );
    } catch (error) {
      throw new StorageUnavailable(error instanceof Error ? error.message : String(error));
    }
  }

  async get(key: string): Promise<{ body: Buffer; contentType: string | undefined }> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const stream = result.Body as Readable;
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk as Buffer);
      }
      return {
        body: Buffer.concat(chunks),
        contentType: result.ContentType,
      };
    } catch (error) {
      if ((error as { name?: string }).name === "NoSuchKey") {
        const missing = new Error("missing") as Error & { missing?: boolean };
        missing.missing = true;
        throw missing;
      }
      throw new StorageUnavailable(error instanceof Error ? error.message : String(error));
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (error) {
      if ((error as { name?: string }).name === "NotFound") return false;
      if ((error as { name?: string }).name === "NoSuchKey") return false;
      throw new StorageUnavailable(error instanceof Error ? error.message : String(error));
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (error) {
      throw new StorageUnavailable(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * A station is playable only when storage is reachable and all four of its
   * stem objects exist. The check is no more than 10 seconds old and a failed
   * check is never reused (DP: Services/MinIO/Playability).
   */
  async stationPlayable(projectId: string, keys: string[]): Promise<boolean> {
    const cacheKey = `${projectId}:${keys.length}`;
    const cached = this.playability.get(cacheKey);
    if (cached && Date.now() - cached.at <= this.playabilityTtlMs) {
      return cached.playable;
    }
    const results = await Promise.all(keys.map((key) => this.exists(key)));
    const playable = results.every((exists) => exists);
    if (playable) {
      this.playability.set(cacheKey, { at: Date.now(), playable: true });
    } else {
      // Never cache a failed check, so the first request after storage returns
      // checks again.
      this.playability.delete(cacheKey);
    }
    return playable;
  }

  clearPlayability(): void {
    this.playability.clear();
  }
}

export function stemKey(projectId: string, stemId: string, format: string): string {
  return `projects/${projectId}/stems/${stemId}.${format}`;
}

export function attachmentKey(enquiryId: string, attachmentId: string, format: string): string {
  return `briefs/${enquiryId}/${attachmentId}.${format}`;
}
