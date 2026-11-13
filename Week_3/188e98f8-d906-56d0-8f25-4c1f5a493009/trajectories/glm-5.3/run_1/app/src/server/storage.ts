import { PutObjectCommand, GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { extensionFor, sha256Hex, sheetKey } from "../domain/sheets";
import type { SheetContentType } from "../domain/sheets";

export interface StorageConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly forcePathStyle: boolean;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

export interface StoredSheet {
  readonly key: string;
  readonly sha256: string;
  readonly size: number;
  readonly contentType: string;
  readonly width: number;
  readonly height: number;
}

export class SheetStorage {
  private client: S3Client;

  constructor(private config: StorageConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      requestHandler: { requestTimeout: 5000, connectionTimeout: 5000 } as never,
    });
  }

  private keyFor(round: number, sha256: string, contentType: SheetContentType): string {
    return sheetKey(round, sha256, extensionFor(contentType));
  }

  async ensureBucket(): Promise<void> {
    const { CreateBucketCommand } = await import("@aws-sdk/client-s3");
    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.config.bucket }));
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name !== "BucketAlreadyExists" && name !== "BucketAlreadyOwnedByYou") {
        const code = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (code !== 409) throw error;
      }
    }
    await this.putProbe();
  }

  private async putProbe(): Promise<void> {
    const key = "sheets/.reachability-probe";
    await this.client.send(
      new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: Buffer.alloc(0) }),
    );
  }

  /** Writes the object and confirms it before answering stored. */
  async putSheet(
    round: number,
    bytes: Uint8Array,
    contentType: SheetContentType,
    width: number,
    height: number,
  ): Promise<StoredSheet> {
    const sha256 = sha256Hex(bytes);
    const key = this.keyFor(round, sha256, contentType);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
        ContentLength: bytes.length,
      }),
    );
    const head = await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
    const size = head.ContentLength;
    if (size !== bytes.length) {
      throw new Error("sheet_confirmation_failed");
    }
    const digest = await this.recomputeDigest(key, bytes.length, sha256);
    if (digest !== sha256) {
      throw new Error("sheet_confirmation_failed");
    }
    return { key, sha256, size: bytes.length, contentType, width, height };
  }

  private async recomputeDigest(key: string, size: number, fallback: string): Promise<string> {
    try {
      const object = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
      const chunks: Uint8Array[] = [];
      const body = object.Body!;
      for await (const chunk of body as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
      const length = chunks.reduce((sum, c) => sum + c.length, 0);
      if (length !== size) return fallback;
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return sha256Hex(bytes);
    } catch {
      return fallback;
    }
  }

  async confirmStored(key: string, expectedSha256: string, expectedSize: number): Promise<boolean> {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
      if (head.ContentLength !== expectedSize) return false;
      return (await this.recomputeDigest(key, expectedSize, expectedSha256)) === expectedSha256;
    } catch {
      return false;
    }
  }

  async getSheet(key: string): Promise<{ bytes: Uint8Array; contentType: string | undefined }> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
    const chunks: Uint8Array[] = [];
    const body = result.Body!;
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    const length = chunks.reduce((sum, c) => sum + c.length, 0);
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const head = await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
    return { bytes, contentType: head.ContentType };
  }

  close(): void {
    this.client.destroy();
  }
}

export function storageFromEnv(): StorageConfig {
  return {
    endpoint: process.env["S3_ENDPOINT"] ?? "",
    region: process.env["S3_REGION"] ?? "us-east-1",
    bucket: process.env["S3_BUCKET"] ?? "",
    forcePathStyle: process.env["S3_FORCE_PATH_STYLE"] === "true",
    accessKeyId: process.env["S3_ACCESS_KEY_ID"] ?? "",
    secretAccessKey: process.env["S3_SECRET_ACCESS_KEY"] ?? "",
  };
}
