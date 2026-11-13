// MinIO object store for evidence files. The app creates the bucket named by
// S3_BUCKET, private, if it is absent, and checks at start and again at each
// storage check until the bucket exists.

import {
  S3Client, CreateBucketCommand, HeadBucketCommand, PutObjectCommand,
  GetObjectCommand, DeleteObjectCommand,
} from '@aws-sdk/client-s3';

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export class ObjectStore {
  private readonly client: S3Client;
  private bucketReady = false;

  constructor(private readonly config: S3Config) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  // Idempotent: checks the bucket, creating it private when absent.
  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
      this.bucketReady = true;
      return;
    } catch {
      // absent or unreachable
    }
    try {
      await this.client.send(
        new CreateBucketCommand({
          Bucket: this.config.bucket,
          ACL: 'private',
        }),
      );
      this.bucketReady = true;
    } catch {
      // Try the head again on the next storage check.
      this.bucketReady = false;
    }
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    // A file exists for the app only after the store has confirmed the write.
    await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
  }

  async get(key: string): Promise<Uint8Array> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    const bytes = await res.Body!.transformToByteArray();
    return bytes;
  }

  async remove(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
  }

  async reachable(): Promise<boolean> {
    try {
      if (!this.bucketReady) {
        await this.ensureBucket();
        return this.bucketReady;
      }
      await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
      return true;
    } catch {
      return false;
    }
  }
}
