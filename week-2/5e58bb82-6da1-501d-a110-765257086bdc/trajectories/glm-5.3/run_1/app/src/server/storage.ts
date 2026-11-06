import { S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { config } from './config.js';

const client = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  forcePathStyle: config.s3.forcePathStyle,
  credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey },
});

export function objectKeyLineFile(missionId: string, lineId: string, fileName: string): string {
  return `lines/${missionId}/${lineId}/${fileName}`;
}

export function objectKeyReport(missionId: string): string {
  return `reports/${missionId}/coverage-report.json`;
}

export async function putObject(key: string, body: Buffer, sha256: string): Promise<void> {
  // Storage checks the bytes itself via the checksum header.
  await client.send(new PutObjectCommand({
    Bucket: config.s3.bucket,
    Key: key,
    Body: body,
    ContentType: key.endsWith('.json') ? 'application/json' : 'application/octet-stream',
    ChecksumSHA256: Buffer.from(sha256, 'hex').toString('base64'),
  }));
}

export interface DownloadStream { stream: NodeJS.ReadableStream; }

export async function getObject(key: string): Promise<DownloadStream> {
  const r = await client.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
  if (!r.Body) throw new Error('no body');
  return { stream: r.Body as unknown as NodeJS.ReadableStream };
}

let storageUp = true;
let lastCheck = 0;

export function storageStatus(): 'up' | 'down' { return storageUp ? 'up' : 'down'; }

export async function checkStorage(): Promise<void> {
  if (Date.now() - lastCheck < 9000) return;
  lastCheck = Date.now();
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.s3.bucket }));
    storageUp = true;
  } catch {
    storageUp = false;
  }
}

export function markStorageDown(): void { storageUp = false; }
export function markStorageUp(): void { storageUp = true; }
