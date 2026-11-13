import { S3Client, PutObjectCommand, GetObjectCommand, CreateBucketCommand } from '@aws-sdk/client-s3';
import { config } from '../config';

export const s3 = new S3Client({
  region: config.s3.region,
  endpoint: config.s3.endpoint,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey },
});

let outageUntil = 0;
export function setStorageOutage(ms: number): void { outageUntil = Date.now() + ms; }
export function storageOut(): boolean { return Date.now() < outageUntil; }

export async function ensureBucket(): Promise<void> {
  try {
    await s3.send(new CreateBucketCommand({ Bucket: config.s3.bucket }));
  } catch (e) {
    const msg = (e as { name?: string }).name ?? String(e);
    if (!msg.includes('BucketAlreadyOwnedByYou')) throw e;
  }
}

async function put(key: string, body: Buffer, contentType: string): Promise<void> {
  await s3.send(new PutObjectCommand({ Bucket: config.s3.bucket, Key: key, Body: body, ContentType: contentType }));
}

async function get(key: string): Promise<Buffer> {
  const r = await s3.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
  return Buffer.from(await r.Body!.transformToByteArray());
}

export const storage = {
  async snapshotPage(siteId: string, versionId: string, snapshotId: string, pagePath: string, html: string): Promise<void> {
    if (storageOut()) throw new Error('storage unavailable');
    await put(`sites/${siteId}/versions/${versionId}/snapshots/${snapshotId}/pages/${pagePath}.html`, Buffer.from(html, 'utf8'), 'text/html');
  },
  async snapshotManifest(siteId: string, versionId: string, snapshotId: string, manifestJson: string): Promise<void> {
    if (storageOut()) throw new Error('storage unavailable');
    await put(`sites/${siteId}/versions/${versionId}/snapshots/${snapshotId}/manifest.json`, Buffer.from(manifestJson, 'utf8'), 'application/json');
  },
  async openapiFile(siteId: string, versionId: string, importId: string, bytes: Buffer): Promise<void> {
    if (storageOut()) throw new Error('storage unavailable');
    await put(`sites/${siteId}/versions/${versionId}/openapi/${importId}.json`, bytes, 'application/json');
  },
  async image(siteId: string, imageId: string, bytes: Buffer, contentType: string): Promise<void> {
    if (storageOut()) throw new Error('storage unavailable');
    await put(`sites/${siteId}/assets/${imageId}`, bytes, contentType);
  },
  async getImage(siteId: string, imageId: string): Promise<{ bytes: Buffer; contentType: string } | null> {
    if (storageOut()) throw new Error('storage unavailable');
    try {
      const bytes = await get(`sites/${siteId}/assets/${imageId}`);
      return { bytes, contentType: 'application/octet-stream' };
    } catch {
      return null;
    }
  },
  async tryGet(key: string): Promise<Buffer | null> {
    if (storageOut()) throw new Error('storage unavailable');
    try { return await get(key); } catch { return null; }
  },
};
