import {
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { Config } from "./config";
import { Readable } from "node:stream";

export class PhotoStorageUnavailable extends Error {
  constructor() {
    super("Photo storage is unavailable");
  }
}

export type PhotoBytes = Buffer;

export interface StoredPhotoObject {
  key: string;
  contentType: string;
}

export class PhotoStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private probeResult: boolean = true;
  private probeAt = 0;
  private inFlight: Promise<void> | null = null;

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
      requestHandler: {
        requestTimeout: 5000,
        connectionTimeout: 2000,
      },
    });
  }

  async probe(): Promise<boolean> {
    const age = Date.now() - this.probeAt;
    if (age < 5000 && this.probeAt > 0) return this.probeResult;
    if (this.inFlight !== null) {
      await this.inFlight;
      return this.probeResult;
    }
    const task = (async () => {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
        this.probeResult = true;
      } catch (error: unknown) {
        this.probeResult = false;
      }
      this.probeAt = Date.now();
    })();
    this.inFlight = task;
    try {
      await task;
    } finally {
      this.inFlight = null;
    }
    return this.probeResult;
  }

  objectKey(loanId: string, stage: string, photoId: string, extension: string): string {
    return `loans/${loanId}/${stage}/${photoId}.${extension}`;
  }

  async put(key: string, contentType: string, bytes: Buffer): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: contentType }),
      );
    } catch {
      throw new PhotoStorageUnavailable();
    }
  }

  async get(key: string): Promise<PhotoBytes> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const stream = result.Body;
      if (!(stream instanceof Readable)) throw new PhotoStorageUnavailable();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer));
      }
      return Buffer.concat(chunks);
    } catch (error) {
      if (error instanceof PhotoStorageUnavailable) throw error;
      throw new PhotoStorageUnavailable();
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch {
      // Removing an object that never fully landed is best-effort.
    }
  }
}
