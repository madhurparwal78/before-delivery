import {
  S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

export class PlotStorage {
  private client: S3Client;
  up = false;
  constructor(
    private endpoint: string, private region: string, private bucket: string,
    accessKeyId: string, secretAccessKey: string, forcePathStyle: boolean,
  ) {
    this.client = new S3Client({
      endpoint, region, forcePathStyle,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  /** Object key: tasks/<task id>/<attachment id>/<file name> */
  static key(taskId: string, attachmentId: string, fileName: string): string {
    const safe = fileName.replace(/[^A-Za-z0-9.\-_]/g, "_");
    return `tasks/${taskId}/${attachmentId}/${safe}`;
  }

  async check(): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: "healthcheck/ping" }));
      this.up = true;
    } catch (e: unknown) {
      const name = (e as { name?: string }).name;
      if (name === "NotFound" || name === "NoSuchKey") this.up = true;
      else this.up = false;
    }
    return this.up;
  }

  /**
   * Stores the object, reads its metadata back to confirm the size matches,
   * and returns the object key. Throws if storage cannot be reached.
   */
  async store(taskId: string, fileName: string, contentType: string, body: Buffer): Promise<string> {
    const attachmentId = randomUUID();
    const key = PlotStorage.key(taskId, attachmentId, fileName);
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket, Key: key, Body: body, ContentType: contentType,
    }));
    const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    if (Number(head.ContentLength) !== body.byteLength) {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
      throw new Error("size mismatch after upload");
    }
    return attachmentId;
  }

  async exists(objectKey: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }));
      return true;
    } catch {
      return false;
    }
  }

  /** Signed GET link, expiring 60 seconds after issue (DP-28). */
  async signedLink(objectKey: string): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }), { expiresIn: 60 });
  }

  async remove(objectKey: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
    } catch { /* best effort */ }
  }
}
