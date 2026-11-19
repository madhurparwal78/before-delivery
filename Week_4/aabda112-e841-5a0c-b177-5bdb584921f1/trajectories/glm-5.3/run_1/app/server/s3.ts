import crypto from 'node:crypto';
import { settings } from './settings.js';

// Minimal S3 client: PUT, GET, HEAD. Storage calls time out after two seconds.
const endpoint = settings.s3Endpoint.replace(/\/$/, '');
const TIMEOUT = 2000;

// A typed failure so the endpoint wrapper can tell a storage outage from a
// database outage.
export class StorageUnavailable extends Error {
  name = 'StorageUnavailable';
}

const withTimeout = async <T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> => {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT);
  try {
    return await fn(ac.signal);
  } catch (e: any) {
    if (ac.signal.aborted || e.name === 'AbortError') throw new StorageUnavailable('storage timeout');
    throw new StorageUnavailable(e.message);
  } finally {
    clearTimeout(timer);
  }
};

const hostHeader = (): string => settings.s3Endpoint.replace(/^https?:\/\//, '').replace(/\/$/, '');

const authHeaders = (method: string, key: string, payload?: Buffer | null): Record<string, string> => {
  const date = new Date();
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const payloadHash = crypto.createHash('sha256').update(payload ?? Buffer.alloc(0)).digest('hex');
  const canonicalHeaders = `host:${hostHeader()}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const canonical = [
    method,
    `/${settings.s3Bucket}${key}`,
    '',
    canonicalHeaders,
    'host;x-amz-content-sha256;x-amz-date',
    payloadHash,
  ].join('\n');
  const scope = `${amzDate.slice(0, 8)}/${settings.s3Region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, crypto.createHash('sha256').update(canonical).digest('hex')].join('\n');
  const k = (s: string, key: Buffer) => crypto.createHmac('sha256', key).update(s).digest();
  const signing = k('aws4_request', k('s3', k(settings.s3Region, k(amzDate.slice(0, 8), Buffer.from(`AWS4${settings.s3SecretAccessKey}`)))));
  const signature = crypto.createHmac('sha256', signing).update(stringToSign).digest('hex');
  return {
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    Authorization: `AWS4-HMAC-SHA256 Credential=${settings.s3AccessKeyId}/${scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`,
  };
};

export async function putObject(key: string, body: Buffer): Promise<void> {
  await withTimeout(async (signal) => {
    const res = await fetch(`${endpoint}/${settings.s3Bucket}${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', ...authHeaders('PUT', key, body) },
      body: new Uint8Array(body),
      signal,
    });
    if (!res.ok) throw new Error(`s3 put ${res.status}`);
  });
}

export async function getObject(key: string): Promise<Buffer> {
  return withTimeout(async (signal) => {
    const res = await fetch(`${endpoint}/${settings.s3Bucket}${key}`, {
      method: 'GET',
      headers: authHeaders('GET', key),
      signal,
    });
    if (!res.ok) throw new Error(`s3 get ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  });
}

export async function isReachable(): Promise<boolean> {
  try {
    const key = `/.roundbook-health-probe-${Date.now()}`;
    await putObject(key, Buffer.alloc(0));
    return true;
  } catch {
    return false;
  }
}
