import * as crypto from 'crypto';
import * as http from 'http';
import { env } from './env';

export interface ObjectStore {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  exists(key: string): Promise<boolean>;
  up(): Promise<boolean>;
}

/**
 * Minimal S3-compatible client for the object store. Signs requests with
 * AWS Signature V4 so no SDK dependency is needed.
 */
export function createObjectStore(): ObjectStore {
  const e = env();
  const endpoint = e.s3.endpoint.replace(/\/$/, '');
  const url = new URL(endpoint);
  const host = url.host;
  const proto = url.protocol === 'https:' ? 'https' : 'http';
  const port = url.port || (proto === 'https' ? '443' : '80');
  const bucket = e.s3.bucket;
  const region = e.s3.region || 'us-east-1';
  const access = e.s3.accessKeyId;
  const secret = e.s3.secretAccessKey;

  function sign(key: Buffer, msg: string): Buffer {
    return crypto.createHmac('sha256', key).update(msg, 'utf8').digest();
  }

  function hmacHex(key: Buffer, msg: string): string {
    return crypto.createHmac('sha256', key).update(msg, 'utf8').digest('hex');
  }

  function sha256Hex(data: Buffer | string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  interface SignedRequest {
    path: string;
    headers: Record<string, string>;
  }

  function buildSigned(method: string, key: string, payload: Buffer, extraHeaders: Record<string, string> = {}): SignedRequest {
    const path = `/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = sha256Hex(payload);
    const headers: Record<string, string> = {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...extraHeaders,
    };
    const sortedNames = Object.keys(headers).sort();
    const canonicalHeaders = sortedNames.map(h => `${h}:${headers[h]}\n`).join('');
    const signedHeaders = sortedNames.join(';');
    const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = `${dateStamp}/${region}/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
    const kDate = sign(Buffer.from(`AWS4${secret}`, 'utf8'), dateStamp);
    const kRegion = sign(kDate, region);
    const kService = sign(kRegion, 's3');
    const kSigning = sign(kService, 'aws4_request');
    const signature = hmacHex(kSigning, stringToSign);
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${access}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return { path, headers };
  }

  function request(method: string, key: string, payload: Buffer, extraHeaders: Record<string, string> = {}): Promise<http.IncomingMessage> {
    const signed = buildSigned(method, key, payload, extraHeaders);
    return new Promise((resolve, reject) => {
      const req = http.request({
        host: url.hostname,
        port: port,
        method,
        path: signed.path,
        headers: signed.headers,
        timeout: 6000,
      }, res => resolve(res));
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(new Error('timeout')); });
      req.end(payload);
    });
  }

  async function ensureBucket(): Promise<void> {
    const head = await new Promise<boolean>((resolve) => {
      const signed = buildSigned('HEAD', '', Buffer.alloc(0));
      const rq = http.request({ host: url.hostname, port, method: 'HEAD', path: `/${bucket}/`, headers: signed.headers, timeout: 4000 }, res => {
        res.resume();
        resolve(true);
      });
      rq.on('error', () => resolve(false));
      rq.on('timeout', () => { rq.destroy(); resolve(false); });
      rq.end();
    });
    if (!head) {
      await new Promise<void>((resolve, reject) => {
        const payload = Buffer.alloc(0);
        const signed = buildSigned('PUT', '', payload);
        const rq = http.request({ host: url.hostname, port, method: 'PUT', path: `/${bucket}/`, headers: { ...signed.headers, 'content-length': '0' }, timeout: 4000 }, res => {
          res.resume();
          const sc = res.statusCode ?? 500; sc < 300 ? resolve() : reject(new Error(`create bucket ${sc}`));
        });
        rq.on('error', reject);
        rq.on('timeout', () => { rq.destroy(new Error('timeout')); reject(new Error('timeout')); });
        rq.end();
      });
    }
  }

  let bucketReady = false;

  return {
    async put(key, data, contentType) {
      if (!bucketReady) { await ensureBucket(); bucketReady = true; }
      const res = await request('PUT', key, data, { 'content-type': contentType, 'content-length': String(data.length) });
      await drain(res);
      if (res.statusCode !== 200) throw new Error(`put ${res.statusCode ?? 'none'}`);
    },
    async get(key) {
      const res = await request('GET', key, Buffer.alloc(0));
      if (res.statusCode === 404) { await drain(res); return null; }
      if (res.statusCode !== 200) { await drain(res); throw new Error(`get ${res.statusCode ?? 'none'}`); }
      const chunks: Buffer[] = [];
      for await (const c of res) chunks.push(c as Buffer);
      return Buffer.concat(chunks);
    },
    async exists(key) {
      const res = await request('HEAD', key, Buffer.alloc(0));
      await drain(res);
      return res.statusCode === 200;
    },
    async up() {
      try {
        if (!bucketReady) { await ensureBucket(); bucketReady = true; }
        return true;
      } catch {
        return false;
      }
    },
  };
}

async function drain(res: http.IncomingMessage): Promise<void> {
  res.resume();
  await new Promise<void>(r => res.on('end', () => r()));
}

export const S3 = { createObjectStore };
