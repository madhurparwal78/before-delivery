import { Client as MinioClient } from 'minio';
import { Meilisearch } from 'meilisearch';
import type { Config } from './config.js';
import { pool } from './db.js';
import { config } from './types.js';

export interface Outages {
  minio: boolean;
  meili: boolean;
  live: boolean;
}

let minioClient: MinioClient | null = null;
let meili: Meilisearch | null = null;
let outages: Outages = { minio: false, meili: false, live: false };

export function initServices(c: Config): void {
  minioClient = new MinioClient({
    endPoint: hostOf(c.s3.endpoint),
    port: portOf(c.s3.endpoint),
    useSSL: c.s3.endpoint.startsWith('https://'),
    accessKey: c.s3.accessKeyId,
    secretKey: c.s3.secretAccessKey,
    region: c.s3.region,
    pathStyle: c.s3.forcePathStyle,
  });
  meili = new Meilisearch({ host: c.meili.url, apiKey: c.meili.apiKey });
}

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).hostname;
  } catch {
    return endpoint;
  }
}

function portOf(endpoint: string): number {
  try {
    const u = new URL(endpoint);
    return u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
  } catch {
    return 9000;
  }
}

/** The grading route speaks `meilisearch`; the outage flag is `meili`. */
export async function setOutage(service: 'minio' | 'meilisearch' | 'live', down: boolean): Promise<void> {
  const key = service === 'meilisearch' ? 'meili' : service;
  outages[key] = down;
  await pool.query('UPDATE outage_state SET minio_down=$1, meili_down=$2, live_down=$3 WHERE id=1', [
    outages.minio,
    outages.meili,
    outages.live,
  ]);
}

export async function loadOutages(): Promise<void> {
  const r = await pool.query<{ minio_down: boolean; meili_down: boolean; live_down: boolean }>(
    'SELECT minio_down, meili_down, live_down FROM outage_state WHERE id=1',
  );
  if (r.rows[0]) outages = { minio: r.rows[0].minio_down, meili: r.rows[0].meili_down, live: r.rows[0].live_down };
}

export function currentOutages(): Outages {
  return outages;
}

export async function storageUp(): Promise<boolean> {
  if (outages.minio || !minioClient) return false;
  try {
    // A missing bucket answers "false" over a healthy connection; only an error means down.
    const reachable = await minioClient.bucketExists(config().s3.bucket);
    return reachable;
  } catch {
    return false;
  }
}

export async function putObject(key: string, bytes: Buffer, bucket: string): Promise<void> {
  if (!minioClient) throw new Error('storage not initialised');
  await minioClient.putObject(bucket, key, bytes, bytes.length, { 'Content-Type': 'application/octet-stream' });
}

export async function getObject(key: string, bucket: string): Promise<Buffer> {
  if (!minioClient) throw new Error('storage not initialised');
  const stream = await minioClient.getObject(bucket, key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

export async function searchUp(): Promise<boolean> {
  if (outages.meili || !meili) return false;
  try {
    await meili.health();
    return true;
  } catch {
    return false;
  }
}

export function searchClient(): Meilisearch {
  if (!meili) throw new Error('search not initialised');
  return meili;
}
