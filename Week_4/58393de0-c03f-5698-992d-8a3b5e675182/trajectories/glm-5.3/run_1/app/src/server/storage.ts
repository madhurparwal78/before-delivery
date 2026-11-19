import * as crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import type { S3Config } from './config.js';

export interface Storage {
  put(key: string, body: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  del(key: string): Promise<void>;
  delPrefix(prefix: string): Promise<void>;
  ping(): Promise<void>;
}

// Minimal S3 client for MinIO with AWS SigV4: PUT/GET/DELETE object,
// list-and-delete a prefix, and a health ping.
export function createStorage(cfg: S3Config): Storage {
  const endpoint = new URL(cfg.endpoint);
  const proto = endpoint.protocol === 'https:' ? https : http;

  async function request(method: string, pathAndQuery: string, body?: Buffer): Promise<{ status: number; data: Buffer }> {
    const fullPath = `/${cfg.bucket}/${pathAndQuery}`.replace(/\/{2,}/g, '/');
    const qIndex = fullPath.indexOf('?');
    const canonicalUri = qIndex === -1 ? fullPath : fullPath.slice(0, qIndex);
    const rawQuery = qIndex === -1 ? '' : fullPath.slice(qIndex + 1);
    // Canonical query string: URI-encoded key=value pairs, sorted.
    const pairs: Array<[string, string]> = rawQuery === '' ? [] : rawQuery.split('&').map((p) => {
      const eq = p.indexOf('=');
      return eq === -1 ? [p, ''] as [string, string] : [p.slice(0, eq), p.slice(eq + 1)] as [string, string];
    });
    pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const canonicalQuery = pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    const amzDate = new Date().toISOString().replaceAll('-', '').replaceAll(':', '').replace(/\.\d{3}Z$/, 'Z');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = crypto.createHash('sha256').update(body ?? Buffer.alloc(0)).digest('hex');
    const canonicalHeaders = `host:${endpoint.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
    const signingKey = hmacChain(`AWS4${cfg.secretAccessKey}`, dateStamp, cfg.region, 's3');
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
    const authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const requestPath = canonicalQuery === '' ? canonicalUri : `${canonicalUri}?${canonicalQuery}`;
    return new Promise((resolve, reject) => {
      const req = proto.request({
        host: endpoint.hostname, port: endpoint.port, path: requestPath, method,
        headers: {
          Authorization: authorization, 'x-amz-date': amzDate, 'x-amz-content-sha256': payloadHash,
          'Content-Length': String(body?.length ?? 0),
        },
        timeout: 2000,
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 500, data: Buffer.concat(chunks) }));
      });
      req.on('timeout', () => { req.destroy(); reject(new Error('storage timeout')); });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }

  function hmacChain(key: string | Buffer, date: string, region: string, service: string): Buffer {
    const kDate = crypto.createHmac('sha256', key).update(date).digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
    const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
    return crypto.createHmac('sha256', kService).update('aws4_request').digest();
  }

  return {
    async put(key, body) {
      const r = await request('PUT', key, body);
      if (r.status >= 300) throw new Error(`storage put failed: ${r.status}`);
    },
    async get(key) {
      const r = await request('GET', key);
      if (r.status >= 300) throw new Error(`storage get failed: ${r.status}`);
      return r.data;
    },
    async del(key) {
      await request('DELETE', key);
    },
    async delPrefix(prefix) {
      const list = await request('GET', `?list-type=2&prefix=${encodeURIComponent(prefix)}`);
      if (list.status >= 300) throw new Error('storage list failed');
      const keys = [...list.data.toString('utf8').matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]!);
      await Promise.all(keys.map((k) => request('DELETE', k).catch(() => undefined)));
    },
    async ping() {
      await request('GET', '?health=');
    },
  };
}
