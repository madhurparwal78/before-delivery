// MinIO object storage client (DP-34, DP-35, DP-46). Objects are streamed
// only through the authorised endpoints, never exposed or presigned.
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export class StorageUnavailable extends Error {
  constructor() {
    super("File storage is unreachable.");
  }
}

export class StorageService {
  readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  }) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      requestHandler: { requestTimeout: 15_000 },
    });
  }

  async reachable(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      throw new StorageUnavailable();
    }
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType })
      );
    } catch {
      throw new StorageUnavailable();
    }
  }

  async get(key: string): Promise<Uint8Array> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const bytes = await result.Body?.transformToByteArray();
      if (!bytes) throw new StorageUnavailable();
      return bytes;
    } catch {
      throw new StorageUnavailable();
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err) {
      const name = (err as { name?: string }).name ?? "";
      if (name === "NotFound" || name === "NoSuchKey") return false;
      // Distinguish "missing object" from "storage down": probe the bucket.
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
        return false;
      } catch {
        throw new StorageUnavailable();
      }
    }
  }

  async delete(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: keys.map((Key) => ({ Key })) },
        })
      );
    } catch {
      throw new StorageUnavailable();
    }
  }
}

export function agreementKey(contractId: string): string {
  return `contracts/${contractId}/agreement-signed.pdf`;
}

export function billOfSaleKey(contractId: string): string {
  return `contracts/${contractId}/bill-of-sale.pdf`;
}

export function conditionPhotoKey(contractId: string, eventId: string, photoId: string): string {
  return `contracts/${contractId}/condition/${eventId}/${photoId}.jpg`;
}
