// MinIO object storage. Objects are written once and never overwritten.
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import type { AppConfig } from "../config.js";

export class Storage {
  private client: S3Client;
  private bucket: string;

  constructor(config: AppConfig["s3"]) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  async putOnce(key: string, bytes: Buffer, contentType: string): Promise<string> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: bytes,
      ContentType: contentType,
    }));
    return createHash("sha256").update(bytes).digest("hex");
  }

  async get(key: string): Promise<{ bytes: Buffer; checksum: string } | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const chunks: Buffer[] = [];
      for await (const chunk of res.Body as AsyncIterable<Buffer>) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      return { bytes, checksum: createHash("sha256").update(bytes).digest("hex") };
    } catch {
      return null;
    }
  }
}
