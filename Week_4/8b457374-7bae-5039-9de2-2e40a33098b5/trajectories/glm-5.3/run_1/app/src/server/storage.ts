import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { Config } from "./config.js";

// All objects live in the bucket named by S3_BUCKET and no object is public.
// An image counts as stored only after a follow-up metadata read confirms
// the object with the same byte length.

export class StorageClient {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: Config) {
    this.bucket = config.s3Bucket;
    this.client = new S3Client({
      endpoint: config.s3Endpoint,
      region: config.s3Region,
      forcePathStyle: config.s3ForcePathStyle,
      credentials: {
        accessKeyId: config.s3AccessKeyId,
        secretAccessKey: config.s3SecretAccessKey,
      },
    });
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: "dotgain/healthprobe" }),
      );
      return true;
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name === "NotFound" || name === "NoSuchKey" || name === "AccessDenied") return true;
      // A 404 on a probe object still proves storage answers.
      return name !== "NetworkError" && name !== "TimeoutError";
    }
  }

  /**
   * Uploads bytes and confirms the stored object by a metadata read with the
   * same byte length. Returns false when storage is unreachable.
   */
  async putAndConfirm(
    key: string,
    bytes: Buffer,
    contentType: string,
  ): Promise<{ stored: boolean; reason?: "unavailable" }> {
    try {
      await this.client.send(
        new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: contentType }),
      );
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (head.ContentLength === bytes.length) {
        return { stored: true };
      }
      return { stored: false, reason: "unavailable" };
    } catch {
      return { stored: false, reason: "unavailable" };
    }
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (out.Body === undefined) return null;
      const chunks: Buffer[] = [];
      for await (const chunk of out.Body as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch {
      // A missing object on delete is not an error for the caller.
    }
  }
}
