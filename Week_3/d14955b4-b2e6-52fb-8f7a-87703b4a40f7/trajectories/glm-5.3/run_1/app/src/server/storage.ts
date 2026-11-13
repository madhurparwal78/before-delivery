// The one attachment-status decision and MinIO storage.
import * as minio from 'minio';
import { loadConfig } from './config';
import { query } from './db';
import { settleAttachment } from './attachments';

export interface StorageClient {
  putObject(bucket: string, key: string, body: Buffer, size: number, metaData: Record<string, string>): Promise<void>;
  statObject(bucket: string, key: string): Promise<{ size: number }>;
}

let client: minio.Client | null = null;

function storage(): minio.Client {
  if (client) return client;
  const config = loadConfig();
  const endpoint = new URL(config.s3.endpoint);
  const port = endpoint.port === '' ? (endpoint.protocol === 'https:' ? 443 : 80) : Number(endpoint.port);
  client = new minio.Client({
    endPoint: endpoint.hostname,
    port,
    useSSL: endpoint.protocol === 'https:',
    accessKey: config.s3.accessKeyId,
    secretKey: config.s3.secretAccessKey,
    region: config.s3.region,
  });
  return client;
}

export async function storeAttachment(gameSlug: string, attachmentId: string, bytes: Buffer, contentType: string): Promise<void> {
  const key = `attachments/${gameSlug}/${attachmentId}`;
  const bucket = loadConfig().s3.bucket;
  await storage().putObject(bucket, key, bytes, bytes.length, { 'Content-Type': contentType });
  const stat = await storage().statObject(bucket, key);
  if (Number(stat.size) !== bytes.length) {
    await settleAttachment(attachmentId, 'failed');
    return;
  }
  await settleAttachment(attachmentId, 'attached');
}

export async function readAttachment(gameSlug: string, attachmentId: string): Promise<Buffer | null> {
  try {
    const stream = await storage().getObject(loadConfig().s3.bucket, `attachments/${gameSlug}/${attachmentId}`);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer));
    }
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}

export async function ensureBucket(): Promise<void> {
  const bucket = loadConfig().s3.bucket;
  try {
    await storage().bucketExists(bucket);
  } catch {
    return;
  }
}

export async function scheduleStore(gameSlug: string, attachmentId: string, bytes: Buffer, contentType: string): Promise<void> {
  void (async () => {
    try {
      await storeAttachment(gameSlug, attachmentId, bytes, contentType);
    } catch {
      await settleAttachment(attachmentId, 'failed');
    }
  })();
}

export async function messageAttachmentCount(messageId: string): Promise<number> {
  const result = await query<{ count: string }>('SELECT count(*)::text AS count FROM attachments WHERE message_id = $1', [messageId]);
  return Number(result.rows[0].count);
}
