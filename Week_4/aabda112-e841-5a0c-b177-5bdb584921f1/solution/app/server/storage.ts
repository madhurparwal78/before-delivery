import { createHash, createHmac } from 'node:crypto';
import { config } from './config.js';

/** The one MinIO client: SigV4 over fetch, path-style, every call bounded by a timeout. */
export class StorageUnavailable extends Error {}

const BASE_TIMEOUT_MS = 2000;

const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest();
const hex = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const encodeSegment = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

interface Reply {
  status: number;
  body: Buffer;
}

async function call(method: 'PUT' | 'GET' | 'HEAD', key: string, body: Buffer = Buffer.alloc(0)): Promise<Reply> {
  const { endpoint, bucket, region, accessKeyId, secretAccessKey } = config.s3;
  const path = `/${encodeSegment(bucket)}${key ? `/${key.split('/').map(encodeSegment).join('/')}` : ''}`;
  const url = new URL(endpoint + path);
  const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = stamp.slice(0, 8);
  const payload = hex(body);
  const headers: Record<string, string> = { host: url.host, 'x-amz-content-sha256': payload, 'x-amz-date': stamp };
  const names = Object.keys(headers).sort();
  const canonical = [
    method,
    url.pathname,
    '',
    names.map((n) => `${n}:${headers[n]}\n`).join(''),
    names.join(';'),
    payload,
  ].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, hex(canonical)].join('\n');
  const signingKey = [day, region, 's3', 'aws4_request'].reduce<Buffer | string>((k, part) => hmac(k, part), `AWS4${secretAccessKey}`);
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
  const { host: _host, ...sent } = headers;
  try {
    const reply = await fetch(url, {
      method,
      headers: sent,
      body: method === 'PUT' ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(BASE_TIMEOUT_MS + Math.ceil(body.length / 1_048_576) * 1000),
    });
    return { status: reply.status, body: Buffer.from(await reply.arrayBuffer()) };
  } catch {
    throw new StorageUnavailable();
  }
}

export async function putObject(key: string, bytes: Buffer): Promise<void> {
  const reply = await call('PUT', key, bytes);
  if (reply.status !== 200) throw new StorageUnavailable();
}

export async function getObject(key: string): Promise<Buffer> {
  const reply = await call('GET', key);
  if (reply.status !== 200) throw new StorageUnavailable();
  return reply.body;
}

/** True when the bucket answers. */
export async function storageReachable(): Promise<boolean> {
  try {
    const reply = await call('HEAD', '');
    return reply.status === 200;
  } catch {
    return false;
  }
}
