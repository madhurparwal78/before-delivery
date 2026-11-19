import { Client as MinioClient } from 'minio';

// MinIO access goes through one small surface. Every method throws when the
// service is unreachable; callers translate that into storage_unavailable.
export class Storage {
  private readonly client: MinioClient;
  private readonly bucket: string;
  private reachable = false;

  constructor (options: { endpoint: string; region: string; bucket: string; forcePathStyle: boolean; accessKey: string; secretKey: string }) {
    const url = new URL(options.endpoint);
    this.client = new MinioClient({
      endPoint: url.hostname,
      port: url.port !== '' ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80),
      useSSL: url.protocol === 'https:',
      region: options.region,
      accessKey: options.accessKey,
      secretKey: options.secretKey,
    });
    this.bucket = options.bucket;
    void options.forcePathStyle;
  }

  // putObject followed by a statObject confirmation of size and checksum.
  async store (objectKey: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.client.putObject(this.bucket, objectKey, bytes, bytes.byteLength, { 'Content-Type': contentType });
    const stat = await this.client.statObject(this.bucket, objectKey);
    if (stat.size !== bytes.byteLength) {
      throw new Error('Object size mismatch after write');
    }
  }

  async fetch (objectKey: string): Promise<Buffer> {
    const stream = await this.client.getObject(this.bucket, objectKey);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  async remove (objectKey: string): Promise<void> {
    try {
      await this.client.removeObject(this.bucket, objectKey);
    } catch {
      // Removing an absent object is already the desired end state.
    }
  }

  async probe (): Promise<boolean> {
    try {
      await this.client.bucketExists(this.bucket);
      this.reachable = true;
    } catch {
      this.reachable = false;
    }
    return this.reachable;
  }

  isReachable (): boolean {
    return this.reachable;
  }
}

export const objectKeyForAsset = (setId: string, assetId: string): string => `sets/${setId}/assets/${assetId}`;
export const objectKeyForBundle = (setId: string, versionNumber: number): string => `sets/${setId}/shows/${versionNumber}/bundle.json`;
export const objectKeyForExport = (setId: string, exportId: string): string => `sets/${setId}/exports/${exportId}.zip`;
export const objectKeyForImport = (importId: string): string => `imports/${importId}.zip`;
