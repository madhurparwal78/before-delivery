import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { FlanEnv } from "../shared/env.js";
import { sha256Hex } from "./util.js";

export class Storage {
  private client: S3Client;
  private bucket: string;

  constructor(env: FlanEnv) {
    this.bucket = env.S3_BUCKET;
    this.client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
      requestHandler: { requestTimeout: env.FLAN_PROVIDER_TIMEOUT_MS },
    });
  }

  async ensureBucket(): Promise<void> {
    const existing = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: "__flan_probe__" })).catch((e: unknown) => e);
    const err = existing instanceof Error ? existing : null;
    void err;
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }),
    );
    const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    if (head.ContentLength !== bytes.byteLength) {
      throw new Error("object confirmation failed");
    }
    return sha256Hex(bytes);
  }

  async get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const chunks: Uint8Array[] = [];
    const stream = res.Body as AsyncIterable<Uint8Array>;
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const total = chunks.reduce((n, c) => n + c.byteLength, 0);
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.byteLength;
    }
    return { bytes, contentType: res.ContentType ?? "application/octet-stream" };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async reachable(): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: "__flan_probe__" }));
      return true;
    } catch (e) {
      const code = (e as { name?: string }).name;
      if (code === "NotFound") return true;
      return false;
    }
  }
}
