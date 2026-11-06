import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import type { AppConfig } from "./config.js";

const UNREACHABLE_CACHE_MS = 5000; // DP-58: a cached failure is reused for at most 5 seconds

/** Wraps the postcard store: every request tries it afresh, caching failures briefly. */
export class PostcardStore {
  private client: S3Client;
  private downSince = 0;

  constructor(private readonly cfg: AppConfig) {
    this.client = new S3Client({
      endpoint: cfg.s3.endpoint,
      region: cfg.s3.region || "us-east-1",
      forcePathStyle: cfg.s3.forcePathStyle,
      credentials: { accessKeyId: cfg.s3.accessKeyId, secretAccessKey: cfg.s3.secretAccessKey },
    });
  }

  /** True when the store answers at all; a missing object counts as reachable. */
  async isOpen(): Promise<boolean> {
    if (this.isDown()) return false;
    try {
      await this.client.send(new HeadObjectCommand({
        Bucket: this.cfg.s3.bucket,
        Key: "postcards/healthcheck.png",
      }));
      this.markUp();
      return true;
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === "NotFound" || name === "NoSuchKey") {
        this.markUp();
        return true;
      }
      this.markDown();
      return false;
    }
  }

  private isDown(): boolean {
    return this.downSince !== 0 && Date.now() - this.downSince < UNREACHABLE_CACHE_MS;
  }

  private markDown(): void {
    this.downSince = Date.now();
  }

  private markUp(): void {
    this.downSince = 0;
  }

  async put(postcardId: string, bytes: Uint8Array, contentType = "image/png"): Promise<boolean> {
    if (this.isDown()) return false;
    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.cfg.s3.bucket,
        Key: `postcards/${postcardId}.png`,
        Body: bytes,
        ContentType: contentType,
      }));
      this.markUp();
      return true;
    } catch {
      this.markDown();
      return false;
    }
  }

  async get(postcardId: string): Promise<Buffer | null> {
    if (this.isDown()) return null;
    try {
      const res = await this.client.send(new GetObjectCommand({
        Bucket: this.cfg.s3.bucket,
        Key: `postcards/${postcardId}.png`,
      }));
      this.markUp();
      const chunks: Buffer[] = [];
      if (res.Body) {
        for await (const chunk of res.Body as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
      }
      const total = chunks.reduce((n, c) => n + c.byteLength, 0);
      const out = Buffer.alloc(total);
      let at = 0;
      for (const c of chunks) {
        out.set(c, at);
        at += c.byteLength;
      }
      return out;
    } catch {
      this.markDown();
      return null;
    }
  }

  async delete(postcardId: string): Promise<boolean> {
    if (this.isDown()) return false;
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.cfg.s3.bucket, Key: `postcards/${postcardId}.png` }));
      await this.client.send(new DeleteObjectCommand({
        Bucket: this.cfg.s3.bucket,
        Key: `postcards/${postcardId}.png`,
      }));
      this.markUp();
      return true;
    } catch (err) {
      const name = (err as { name?: string }).name;
      // A missing object deletes cleanly.
      if (name === "NotFound" || name === "NoSuchKey") {
        this.markUp();
        return true;
      }
      this.markDown();
      return false;
    }
  }
}
