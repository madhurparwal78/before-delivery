import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";

/**
 * MinIO object storage for computed bodies. One object per stored build at
 * bodies/<part id>/build-<build>.json. The bucket already exists; the app
 * never creates or deletes buckets.
 */

export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export function objectKey(partId: string, build: number): string {
  return `bodies/${partId}/build-${build}.json`;
}

export class BodyStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: StorageConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    });
    this.bucket = config.bucket;
  }

  /** Returns true once the object is confirmed written, within 5 seconds. */
  async putBody(key: string, payload: string): Promise<boolean> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: "application/json",
      Body: payload
    });
    const deadline = new Promise<false>((resolve) => setTimeout(() => resolve(false), 5000));
    try {
      return await Promise.race([this.client.send(command).then(() => true), deadline]);
    } catch {
      return false;
    }
  }

  async getBody(key: string): Promise<string | null> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    const deadline = new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000));
    try {
      const reply = await Promise.race([this.client.send(command), deadline]);
      if (!reply || !reply.Body) return null;
      return await streamToText(reply.Body as Readable);
    } catch {
      return null;
    }
  }
}

async function streamToText(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks).toString("utf8");
}

interface HealthCheck {
  lastCheck: number;
  ok: boolean;
}

/**
 * The single storage health check used by GET /api/status: a check made
 * within the last 5 seconds is reused.
 */
export class StorageHealth {
  private state: HealthCheck = { lastCheck: 0, ok: false };
  private pending: Promise<boolean> | null = null;

  constructor(
    private readonly store: BodyStore,
    private readonly probeKey = "bodies/health-probe.json"
  ) {}

  async reachable(force = false): Promise<boolean> {
    const now = Date.now();
    if (!force && now - this.state.lastCheck < 5000) return this.state.ok;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      const ok = await this.store.putBody(this.probeKey, JSON.stringify({ checked_at: now }));
      this.state = { lastCheck: Date.now(), ok };
      this.pending = null;
      return ok;
    })();
    return this.pending;
  }

  lastKnown(): boolean {
    return Date.now() - this.state.lastCheck < 5000 ? this.state.ok : false;
  }
}
