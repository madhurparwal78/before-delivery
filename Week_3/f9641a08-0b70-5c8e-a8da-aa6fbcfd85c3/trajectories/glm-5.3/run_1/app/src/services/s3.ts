import { createHmac, createHash } from 'node:crypto';
import { CONFIG } from '../config.js';

/** Minimal SigV4 client for MinIO, with read-back confirmation of exact bytes. */
export const s3 = {
  async put(key: string, body: Buffer, contentType: string): Promise<boolean> {
    const url = new URL(`${CONFIG.s3Endpoint}/${CONFIG.s3Bucket}/${key}`);
    let res: Response;
    try {
      res = await signedFetch('PUT', url, body, {
        'content-type': contentType,
        'content-length': String(body.length),
      });
    } catch {
      // Storage unreachable: nothing was published.
      return false;
    }
    if (!res.ok) return false;
    return this.confirmSize(key, body.length);
  },

  async confirmSize(key: string, expectedBytes: number): Promise<boolean> {
    const url = new URL(`${CONFIG.s3Endpoint}/${CONFIG.s3Bucket}/${key}`);
    let res: Response;
    try {
      res = await signedFetch('HEAD', url, Buffer.alloc(0), {});
    } catch {
      return false;
    }
    if (!res.ok) return false;
    const size = Number(res.headers.get('content-length') ?? '-1');
    return size === expectedBytes;
  },

  async get(key: string): Promise<Buffer | null> {
    const url = new URL(`${CONFIG.s3Endpoint}/${CONFIG.s3Bucket}/${key}`);
    let res: Response;
    try {
      res = await signedFetch('GET', url, Buffer.alloc(0), {});
    } catch {
      return null;
    }
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  },

  async health(): Promise<boolean> {
    const url = new URL(`${CONFIG.s3Endpoint}/minio/health/live`);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      try {
        const res = await fetch(url, { signal: controller.signal });
        return res.ok;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return false;
    }
  },
};

const SERVICE = 's3';

async function signedFetch(method: string, url: URL, body: Buffer, headers: Record<string, string>): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = createHash('sha256').update(body).digest('hex');
    const host = url.host;
    const allHeaders: Record<string, string> = {
      host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
      ...Object.fromEntries(Object.entries(headers).filter(([k]) => k !== 'host')),
    };
    const signedHeadersList = Object.keys(allHeaders).map((k) => k.toLowerCase()).sort();
    const headerMap: Record<string, string> = {};
    for (const [k, v] of Object.entries(allHeaders)) headerMap[k.toLowerCase()] = v;
    const canonicalHeadersJoined = signedHeadersList.map((k) => `${k}:${headerMap[k]}\n`).join('');
    const signedHeaders = signedHeadersList.join(';');
    const canonicalRequest = [method, url.pathname, url.search, canonicalHeadersJoined, signedHeaders, payloadHash].join('\n');
    const scope = `${dateStamp}/${CONFIG.s3Region}/${SERVICE}/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
    const signingKey = hmacChain(CONFIG.s3SecretAccessKey, dateStamp, CONFIG.s3Region, SERVICE);
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
    const authorization = `AWS4-HMAC-SHA256 Credential=${CONFIG.s3AccessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const finalHeaders: Record<string, string> = { ...headerMap, authorization };
    return await fetch(url, {
      method,
      headers: finalHeaders,
      body: method === 'GET' || method === 'HEAD' ? undefined : new Uint8Array(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function hmacChain(secret: string, date: string, region: string, service: string): Buffer {
  const kDate = createHmac('sha256', `AWS4${secret}`).update(date).digest();
  const kRegion = createHmac('sha256', kDate).update(region).digest();
  const kService = createHmac('sha256', kRegion).update(service).digest();
  return createHmac('sha256', kService).update('aws4_request').digest();
}
