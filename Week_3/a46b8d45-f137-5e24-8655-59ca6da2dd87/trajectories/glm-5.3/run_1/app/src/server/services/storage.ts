// MinIO stores the photos and the dispatch notes. The browser never talks to it.
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import type { DeskConfig } from '../config.js';

export class StorageUnavailable extends Error {
  constructor() { super('storage_unavailable'); this.name = 'StorageUnavailable'; }
}

export class StorageClient {
  private readonly s3: S3Client;
  constructor(private readonly config: DeskConfig) {
    this.s3 = new S3Client({
      endpoint: config.s3.endpoint,
      region: config.s3.region,
      forcePathStyle: config.s3.forcePathStyle,
      credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey },
    });
  }

  private key(reference: string, rest: string): string {
    return `claims/${reference}/${rest}`;
  }

  async putPhoto(reference: string, index: number, body: Uint8Array, contentType: string): Promise<void> {
    await this.put(this.key(reference, `photos/${index}`), body, contentType);
  }

  async putDispatchNote(reference: string, html: string): Promise<void> {
    await this.put(this.key(reference, 'dispatch-note.html'), new TextEncoder().encode(html), 'text/html; charset=utf-8');
  }

  private async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    try {
      await this.s3.send(new PutObjectCommand({
        Bucket: this.config.s3.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }));
    } catch {
      throw new StorageUnavailable();
    }
  }

  async getPhoto(reference: string, index: number): Promise<{ body: Uint8Array; contentType: string } | null> {
    try {
      const res = await this.s3.send(new GetObjectCommand({
        Bucket: this.config.s3.bucket,
        Key: this.key(reference, `photos/${index}`),
      }));
      const bytes = new Uint8Array(await res.Body!.transformToByteArray());
      return { body: bytes, contentType: res.ContentType ?? 'application/octet-stream' };
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (name === 'NoSuchKey' || name === 'NotFound') return null;
      throw new StorageUnavailable();
    }
  }

  async getDispatchNote(reference: string): Promise<string | null> {
    try {
      const res = await this.s3.send(new GetObjectCommand({
        Bucket: this.config.s3.bucket,
        Key: this.key(reference, 'dispatch-note.html'),
      }));
      return await res.Body!.transformToString('utf-8');
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (name === 'NoSuchKey' || name === 'NotFound') return null;
      throw new StorageUnavailable();
    }
  }

  async listClaimObjects(reference: string): Promise<string[]> {
    try {
      const out: string[] = [];
      let token: string | undefined;
      do {
        const res = await this.s3.send(new ListObjectsV2Command({
          Bucket: this.config.s3.bucket,
          Prefix: `claims/${reference}/`,
          ContinuationToken: token,
        }));
        for (const obj of res.Contents ?? []) if (obj.Key) out.push(obj.Key);
        token = res.NextContinuationToken;
      } while (token);
      return out;
    } catch {
      throw new StorageUnavailable();
    }
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.config.s3.bucket, Key: key }));
    } catch {
      throw new StorageUnavailable();
    }
  }

  async deleteClaimObjects(reference: string): Promise<void> {
    const keys = await this.listClaimObjects(reference);
    for (const key of keys) await this.deleteObject(key);
  }
}
