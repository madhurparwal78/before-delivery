// MinIO client over SigV4 (aws4fetch). Documents live at
// documents/<member id>/<document id>; packet PDFs at packets/<packet id>.pdf.
// The bucket is private; the app is the only reader.

import { AwsClient } from 'aws4fetch';
import { loadConfig } from './config.js';

export class StorageUnavailable extends Error {}

let client: AwsClient;

function aws(): AwsClient {
  const c = loadConfig();
  if (!client) {
    client = new AwsClient({
      accessKeyId: c.s3AccessKeyId,
      secretAccessKey: c.s3SecretAccessKey,
      region: c.s3Region,
      service: 's3',
    });
  }
  return client;
}

function objectUrl(key: string): string {
  const c = loadConfig();
  const endpoint = c.s3Endpoint.replace(/\/+$/, '');
  if (c.s3ForcePathStyle) return `${endpoint}/${c.s3Bucket}/${key}`;
  const u = new URL(endpoint);
  return `${u.protocol}//${c.s3Bucket}.${u.host}/${key}`;
}

async function signed(method: string, key: string, body?: Buffer, contentType?: string): Promise<Response> {
  const url = new URL(objectUrl(key));
  const headers: Record<string, string> = {};
  if (contentType) headers['Content-Type'] = contentType;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    let bodyBytes: ArrayBuffer | undefined;
    if (body) {
      bodyBytes = new Uint8Array(body).buffer as ArrayBuffer;
    }
    return await aws().fetch(url.toString(), {
      method,
      headers,
      body: bodyBytes,
      signal: controller.signal,
    });
  } catch {
    throw new StorageUnavailable('minio unreachable');
  } finally {
    clearTimeout(timer);
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const res = await signed('PUT', key, body, contentType);
  if (!res.ok) throw new StorageUnavailable(`minio put failed: ${res.status}`);
}

export async function getObject(key: string): Promise<Buffer> {
  const res = await signed('GET', key);
  if (res.status === 404) throw new Error('not_found');
  if (!res.ok) throw new StorageUnavailable(`minio get failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function objectExists(key: string): Promise<boolean> {
  const res = await signed('HEAD', key);
  if (res.ok) return true;
  if (res.status === 404) return false;
  throw new StorageUnavailable(`minio head failed: ${res.status}`);
}

export function documentKey(memberId: string, documentId: string): string {
  return `documents/${memberId}/${documentId}`;
}

export function packetKey(packetId: string): string {
  return `packets/${packetId}.pdf`;
}

export async function probeStorage(): Promise<void> {
  // A HEAD on the bucket root answers even when the key namespace is empty.
  const res = await signed('HEAD', '').catch(() => {
    throw new StorageUnavailable('minio unreachable');
  });
  if (res.status >= 500) throw new StorageUnavailable(`minio health ${res.status}`);
}
