import { createHash, createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { env } from '../env.ts';

const SERVICE = 's3';
const UNSIGNED_HEADERS = 'host;x-amz-content-sha256;x-amz-date';
const STORE_TIMEOUT_MS = 10_000;

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function encodeKey(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function amzDate(now: Date): { stamp: string; date: string } {
  const stamp = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  return { stamp, date: stamp.slice(0, 8) };
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function sign(method: string, key: string, payload: Buffer, extraHeaders: Record<string, string> = {}): SignedRequest {
  const base = new URL(env.s3.endpoint);
  const path = env.s3.forcePathStyle
    ? `/${env.s3.bucket}${key === '' ? '' : `/${encodeKey(key)}`}`
    : `/${encodeKey(key)}`;
  const { stamp, date } = amzDate(new Date());
  const payloadHash = sha256Hex(payload);
  const host = base.host;
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${stamp}\n`;
  const canonicalRequest = [method, path, '', canonicalHeaders, UNSIGNED_HEADERS, payloadHash].join('\n');
  const scope = `${date}/${env.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${env.s3.secretAccessKey}`, date), env.s3.region), SERVICE),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  return {
    url: `${base.origin}${path}`,
    headers: {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': stamp,
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${env.s3.accessKeyId}/${scope}, ` +
        `SignedHeaders=${UNSIGNED_HEADERS}, Signature=${signature}`,
      ...extraHeaders,
    },
  };
}

export class EvidenceStoreUnavailable extends Error {}

async function send(
  method: string,
  key: string,
  payload: Buffer,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const signed = sign(method, key, payload, extraHeaders);
  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: method === 'PUT' ? payload : undefined,
      signal: AbortSignal.timeout(STORE_TIMEOUT_MS),
    });
  } catch {
    throw new EvidenceStoreUnavailable('evidence store unreachable');
  }
}

export const evidenceStore = {
  /** A missing bucket is created at start. */
  async ensureBucket(): Promise<void> {
    const head = await send('HEAD', '', Buffer.alloc(0));
    if (head.ok) return;
    const created = await send('PUT', '', Buffer.alloc(0));
    if (!created.ok && created.status !== 409) {
      throw new EvidenceStoreUnavailable(`bucket create failed with ${created.status}`);
    }
  },

  async probe(): Promise<boolean> {
    try {
      const response = await send('HEAD', '', Buffer.alloc(0));
      return response.ok;
    } catch {
      return false;
    }
  },

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    const response = await send('PUT', key, bytes, { 'content-type': contentType });
    if (!response.ok) throw new EvidenceStoreUnavailable(`put failed with ${response.status}`);
  },

  async exists(key: string): Promise<boolean> {
    const response = await send('HEAD', key, Buffer.alloc(0));
    if (response.status === 404) return false;
    if (!response.ok) throw new EvidenceStoreUnavailable(`head failed with ${response.status}`);
    return true;
  },

  async getRange(key: string, start: number, end: number): Promise<Readable> {
    const response = await send('GET', key, Buffer.alloc(0), { range: `bytes=${start}-${end}` });
    if (!response.ok || response.body === null) {
      throw new EvidenceStoreUnavailable(`get failed with ${response.status}`);
    }
    return Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
  },

  async delete(key: string): Promise<void> {
    await send('DELETE', key, Buffer.alloc(0)).catch(() => undefined);
  },
};
