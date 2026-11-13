import * as Minio from 'minio';
import { Readable } from 'node:stream';
import type { AppConfig } from '../config';

export interface StoredObject {
  bucket: string;
  key: string;
  size: number;
}

export class Storage {
  private client: Minio.Client;
  readonly bucket: string;

  constructor(config: AppConfig) {
    this.bucket = config.s3.bucket;
    this.client = new Minio.Client({
      endPoint: config.s3.endpoint,
      port: config.s3.port,
      useSSL: false,
      accessKey: config.s3.accessKeyId,
      secretKey: config.s3.secretAccessKey,
      region: config.s3.region,
    });
  }

  async putObject(key: string, stream: Readable, size: number, contentType: string): Promise<void> {
    await this.client.putObject(this.bucket, key, stream, size, { 'Content-Type': contentType });
  }

  async statObject(key: string): Promise<number> {
    const stat = await this.client.statObject(this.bucket, key);
    return stat.size;
  }

  getObject(key: string): Promise<Readable> {
    return this.client.getObject(this.bucket, key);
  }

  async removeObject(key: string): Promise<void> {
    await this.client.removeObject(this.bucket, key);
  }

  async removeIncompleteUpload(key: string): Promise<void> {
    try {
      await this.client.removeIncompleteUpload(this.bucket, key);
    } catch {
      // no incomplete upload to clean
    }
  }
}

export function intakeKey(engagementId: string, fileId: string, ext: string): string {
  return `intake/${engagementId}/${fileId}.${ext}`;
}

export function stillKey(engagementId: string, milestone: string, stillId: string, ext: string): string {
  return `stills/${engagementId}/${milestone}/${stillId}.${ext}`;
}
