import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Config } from '../config';

export class TicketStorageUnavailableError extends Error {
  constructor(cause: unknown) {
    super('MinIO is unreachable');
    this.name = 'TicketStorageUnavailableError';
    this.cause = cause;
  }
}

export class TicketStorage {
  private readonly client: S3Client;

  constructor(private readonly config: Config) {
    this.client = new S3Client({
      endpoint: config.s3.endpoint,
      region: config.s3.region,
      forcePathStyle: config.s3.forcePathStyle,
      credentials: {
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey,
      },
      maxAttempts: 2,
    });
  }

  /** Each e-ticket lives at `tickets/<pnr>/v<version>-<kind>.pdf`. */
  static objectKey(pnr: string, version: number, kind: string): string {
    return `tickets/${pnr}/v${version}-${kind}.pdf`;
  }

  async put(key: string, body: Buffer): Promise<{ etag: string }> {
    try {
      const result = await this.client.send(new PutObjectCommand({
        Bucket: this.config.s3.bucket,
        Key: key,
        Body: body,
        ContentType: 'application/pdf',
      }));
      return { etag: result.ETag ?? '' };
    } catch (error) {
      throw new TicketStorageUnavailableError(error);
    }
  }

  async get(key: string): Promise<{ body: Buffer; etag: string }> {
    try {
      const result = await this.client.send(new GetObjectCommand({
        Bucket: this.config.s3.bucket,
        Key: key,
      }));
      const bytes = await result.Body?.transformToByteArray();
      if (bytes === undefined) throw new Error('empty object body');
      return { body: Buffer.from(bytes), etag: result.ETag ?? '' };
    } catch (error) {
      throw new TicketStorageUnavailableError(error);
    }
  }
}
