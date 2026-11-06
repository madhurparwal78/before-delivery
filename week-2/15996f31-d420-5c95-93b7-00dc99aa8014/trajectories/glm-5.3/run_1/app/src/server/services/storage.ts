import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import type { Config } from "../config.ts";
import { ApiError } from "../errors.ts";

/**
 * MinIO object storage for frame photos and signed report PDFs, plus the
 * expiring file links that serve them. Keys are made by the server; client
 * file names are never used.
 */
export type PhotoFormat = "jpg" | "png" | "webp";

export function detectImageFormat(bytes: Uint8Array): PhotoFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length >= 12) {
    const ascii = Buffer.from(bytes.subarray(0, 4)).toString("latin1");
    const tail = Buffer.from(bytes.subarray(8, 12)).toString("latin1");
    if (ascii === "RIFF" && tail === "WEBP") return "webp";
  }
  return null;
}

export function contentTypeFor(format: PhotoFormat): string {
  if (format === "jpg") return "image/jpeg";
  if (format === "png") return "image/png";
  return "image/webp";
}

export class Storage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private bucketReady = false;

  constructor(config: Config) {
    this.bucket = config.s3Bucket;
    this.client = new S3Client({
      region: config.s3Region,
      endpoint: config.s3Endpoint,
      forcePathStyle: config.s3ForcePathStyle,
      credentials: {
        accessKeyId: config.s3AccessKeyId,
        secretAccessKey: config.s3SecretAccessKey,
      },
      requestHandler: new NodeHttpHandler({
        requestTimeout: 5000,
        connectionTimeout: 3000,
      }),
    });
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      } catch {
        // Unreachable storage is tolerated at boot; actions answer 503 later.
      }
    }
    this.bucketReady = true;
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }));
    } catch {
      throw ApiError.storage();
    }
  }

  async get(key: string): Promise<Uint8Array> {
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!response.Body) throw ApiError.storage();
      return await response.Body.transformToByteArray();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw ApiError.storage();
    }
  }

  /** Removes an object left over when an all-or-nothing flow fails. */
  async remove(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch {
      // A stray object from a failed flow is never referenced by the database.
    }
  }

  photoKey(orderId: string, photoId: string, format: PhotoFormat): string {
    return `inspections/${orderId}/photos/${photoId}.${format}`;
  }

  reportKey(orderId: string, linkId: string): string {
    return `inspections/${orderId}/report-${linkId}.pdf`;
  }

  get ready(): boolean {
    return this.bucketReady;
  }
}
