import type { Config } from "./config.js";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand, CreateBucketCommand, BucketAlreadyOwnedByYou } from "@aws-sdk/client-s3";

export type StoreResult = "ok" | "unavailable";

export class ObjectStore {
  private client: S3Client;

  constructor(private config: Config) {
    this.client = new S3Client({
      endpoint: config.s3.endpoint,
      region: config.s3.region,
      forcePathStyle: config.s3.forcePathStyle,
      credentials: {
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey,
      },
    });
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.config.s3.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.config.s3.bucket }));
      } catch (error) {
        if (!(error instanceof BucketAlreadyOwnedByYou)) {
          throw error;
        }
      }
    }
  }

  reportKey(memberId: string, drawId: string): string {
    return `members/${memberId}/draws/${drawId}/report.pdf`;
  }

  attachmentOriginalKey(memberId: string, attachmentId: string): string {
    return `members/${memberId}/attachments/${attachmentId}/original`;
  }

  attachmentCleanKey(memberId: string, attachmentId: string): string {
    return `members/${memberId}/attachments/${attachmentId}/clean`;
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<StoreResult> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.config.s3.bucket,
          Key: key,
          Body: bytes,
          ContentType: contentType,
        })
      );
      return "ok";
    } catch {
      return "unavailable";
    }
  }

  async get(key: string): Promise<Buffer | null | "unavailable"> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.s3.bucket, Key: key })
      );
      if (!result.Body) return null;
      const chunks: Buffer[] = [];
      const stream = result.Body as AsyncIterable<Uint8Array>;
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name === "NoSuchKey") return null;
      return "unavailable";
    }
  }

  async delete(key: string): Promise<StoreResult> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.config.s3.bucket, Key: key })
      );
      return "ok";
    } catch {
      return "unavailable";
    }
  }
}
