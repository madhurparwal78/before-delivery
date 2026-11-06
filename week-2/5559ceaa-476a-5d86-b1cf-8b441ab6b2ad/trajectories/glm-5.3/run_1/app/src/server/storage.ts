import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import type { Config } from "./config.js";

export class Storage {
  private client: S3Client;
  private bucket: string;

  constructor(cfg: Config) {
    this.bucket = cfg.s3.bucket;
    this.client = new S3Client({
      endpoint: cfg.s3.endpoint,
      region: cfg.s3.region,
      forcePathStyle: cfg.s3.forcePathStyle,
      credentials: { accessKeyId: cfg.s3.accessKeyId, secretAccessKey: cfg.s3.secretAccessKey },
      requestHandler: { requestTimeout: 5000, connectionTimeout: 3000 },
      maxAttempts: 1,
    });
  }

  async putObject(key: string, bytes: Buffer, checksumBase64?: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ...(checksumBase64 ? { ChecksumSHA256: checksumBase64 } : {}),
      }),
    );
  }

  async getObject(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error("empty body");
    const chunks: Buffer[] = [];
    for await (const chunk of res.Body as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /** Upload a blob with its SHA-256 checksum and confirm storage holds the exact bytes. */
  async putBlobConfirmed(projectId: string, sha256Hex: string, bytes: Buffer): Promise<void> {
    const key = `projects/${projectId}/blobs/${sha256Hex}`;
    const checksum = createHash("sha256").update(bytes).digest("base64");
    const existingOk = await this.blobConfirmed(projectId, sha256Hex).catch(() => false);
    if (existingOk) return;
    await this.putObject(key, bytes, checksum);
    const confirmed = await this.blobConfirmed(projectId, sha256Hex);
    if (!confirmed) throw new Error(`blob ${sha256Hex} not confirmed after upload`);
  }

  /** Confirm the object at the blob key matches its key by hash. */
  async blobConfirmed(projectId: string, sha256Hex: string): Promise<boolean> {
    const key = `projects/${projectId}/blobs/${sha256Hex}`;
    let headChecksum: string | undefined;
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      headChecksum = head.ChecksumSHA256;
    } catch {
      return false;
    }
    if (headChecksum) {
      const expect = createHash("sha256").update(Buffer.from(sha256Hex, "hex")).digest("base64");
      if (headChecksum === expect) return true;
    }
    try {
      const bytes = await this.getObject(key);
      return createHash("sha256").update(bytes).digest("hex") === sha256Hex;
    } catch {
      return false;
    }
  }

  blobKey(projectId: string, sha256Hex: string): string {
    return `projects/${projectId}/blobs/${sha256Hex}`;
  }

  manifestKey(projectId: string, checkpointId: string): string {
    return `projects/${projectId}/checkpoints/${checkpointId}/manifest.json`;
  }

  quarantineKey(importId: string): string {
    return `quarantine/${importId}.zip`;
  }

  /** List every object key under a prefix. */
  async listPrefix(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const obj of res.Contents ?? []) if (obj.Key) keys.push(obj.Key);
      token = res.NextContinuationToken;
    } while (token);
    return keys;
  }

  /** Delete every object under a prefix. */
  async deletePrefix(prefix: string): Promise<void> {
    const keys = await this.listPrefix(prefix);
    for (const key of keys) {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    }
  }

  async deleteKeys(keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    }
  }
}
