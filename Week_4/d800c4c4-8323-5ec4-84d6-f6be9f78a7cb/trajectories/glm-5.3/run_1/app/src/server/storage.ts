// Object storage: condition photos, stored byte for byte with the submitted type.
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { StorageDown } from './storageErrors';

export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export class Storage {
  private readonly client: S3Client;

  constructor(private readonly config: StorageConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      requestHandler: { requestTimeout: 10000 },
    });
  }

  async put(key: string, body: Buffer, contentType: string, metadata: Record<string, string>): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: body, ContentType: contentType, Metadata: metadata }),
      );
    } catch (err) {
      throw new StorageDown(err);
    }
  }

  async get(key: string): Promise<{ body: Buffer; contentType: string | undefined }> {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
      const chunks: Buffer[] = [];
      const stream = out.Body;
      if (stream === undefined) throw new StorageDown(new Error('empty body'));
      const chunksAsync = stream as AsyncIterable<Uint8Array>;
      for await (const chunk of chunksAsync) {
        chunks.push(Buffer.from(chunk));
      }
      return { body: Buffer.concat(chunks), contentType: out.ContentType };
    } catch (err) {
      if (err instanceof StorageDown) throw err;
      throw new StorageDown(err);
    }
  }

  async ping(): Promise<void> {
    // A 404 for a missing probe key still proves the bucket is reachable.
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: 'healthcheck.txt' }));
    } catch (err) {
      const name = err instanceof Error && 'name' in err ? (err as { name?: string }).name : '';
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (name === 'NotFound' || status === 404) return;
      throw new StorageDown(err);
    }
  }
}
