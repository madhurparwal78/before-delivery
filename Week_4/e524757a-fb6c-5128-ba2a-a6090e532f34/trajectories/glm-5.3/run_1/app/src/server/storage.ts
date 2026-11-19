import * as minio from "minio";
import { Config } from "../shared/config";

export type ImageType = "image/png" | "image/jpeg";

export interface Storage {
  put(objectKey: string, buffer: Buffer, contentType: ImageType): Promise<void>;
  get(objectKey: string): Promise<Buffer | null>;
  healthy(): Promise<boolean>;
}

export function objectKeyFor(photoId: string, type: ImageType): string {
  const ext = type === "image/png" ? "png" : "jpg";
  return `photos/${photoId}.${ext}`;
}

export function createStorage(config: Config): Storage {
  const endpoint = new URL(config.s3.endpoint || "http://127.0.0.1:9000");
  const client = new minio.Client({
    endPoint: endpoint.hostname,
    port: endpoint.port ? Number(endpoint.port) : 80,
    useSSL: endpoint.protocol === "https:",
    accessKey: config.s3.accessKeyId,
    secretKey: config.s3.secretAccessKey,
    region: config.s3.region
  });
  const bucket = config.s3.bucket;
  let bucketReady: Promise<void> | null = null;

  function ensureBucket(): Promise<void> {
    if (!bucketReady) {
      bucketReady = (async () => {
        const exists = await client.bucketExists(bucket);
        if (!exists) await client.makeBucket(bucket, config.s3.region);
      })().catch(() => {
        bucketReady = null;
      }) as Promise<void>;
    }
    return bucketReady;
  }

  return {
    async put(objectKey, buffer, contentType) {
      await ensureBucket();
      await client.putObject(bucket, objectKey, buffer, buffer.length, { "Content-Type": contentType });
    },
    async get(objectKey) {
      await ensureBucket().catch(() => undefined);
      try {
        const stream = await client.getObject(bucket, objectKey);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk as Buffer);
        return Buffer.concat(chunks);
      } catch {
        return null;
      }
    },
    async healthy() {
      try {
        return await client.bucketExists(bucket);
      } catch {
        return false;
      }
    }
  };
}
