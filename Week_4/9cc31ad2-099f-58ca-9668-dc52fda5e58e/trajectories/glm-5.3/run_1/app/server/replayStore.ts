// MinIO replay store over the S3 REST protocol (no SDK dependency).
import { createHmac, createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { Config } from './config.js';

/**
 * A minimal S3 client for the two calls this app needs: PutObject with
 * If-None-Match style no-overwrite behaviour and GetObject. Objects are never
 * overwritten: PutObject uses the Copy-if-not-exists idiom via a conditional
 * PUT is not available, so we check existence first inside the store call.
 */
export class ReplayStore {
  private available = true;
  private lastCheck = 0;

  constructor(private cfg: Config) {}

  private endpoint(): URL {
    return new URL(this.cfg.s3.endpoint);
  }

  private sign(method: string, path: string, payload: Buffer, extraHeaders: Record<string, string>): { url: URL; headers: Record<string, string> } {
    const url = this.endpoint();
    const host = url.hostname;
    // The signed host carries the port whenever the endpoint names one.
    const port = url.port;
    const hostHeader = port ? `${host}:${port}` : `${host}:${url.protocol === 'https:' ? '443' : '80'}`;
    const canonicalUri = path;
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = createHash('sha256').update(payload).digest('hex');
    const headers: Record<string, string> = {
      host: hostHeader,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...extraHeaders
    };
    const sortedKeys = Object.keys(headers).sort();
    const canonicalHeaders = sortedKeys.map(k => `${k}:${headers[k]}\n`).join('');
    const signedHeaders = sortedKeys.join(';');
    const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = `${dateStamp}/${this.cfg.s3.region}/s3/aws4_request`;
    const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
    const kDate = createHmac('sha256', `AWS4${this.cfg.s3.secretAccessKey}`).update(dateStamp).digest();
    const kRegion = createHmac('sha256', kDate).update(this.cfg.s3.region).digest();
    const kService = createHmac('sha256', kRegion).update('s3').digest();
    const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
    const signature = createHmac('sha256', kSigning).update(toSign).digest('hex');
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.cfg.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return { url, headers };
  }

  private s3Request(method: string, path: string, payload: Buffer, extraHeaders: Record<string, string> = {}): Promise<{ status: number; body: Buffer }> {
    return new Promise((resolve, reject) => {
      const { url, headers } = this.sign(method, path, payload, extraHeaders);
      const doRequest = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const req = doRequest({
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path,
        method,
        // The Host header must match the signed host exactly.
        headers: { ...headers, host: headers.host, 'content-length': String(payload.length) }
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
      });
      req.on('error', reject);
      req.setTimeout(2000, () => { req.destroy(new Error('S3 timeout')); });
      req.end(payload);
    });
  }

  async ping(): Promise<boolean> {
    try {
      const r = await this.s3Request('HEAD', `/${this.cfg.s3.bucket}/`, Buffer.alloc(0));
      this.available = r.status === 200;
    } catch {
      this.available = false;
    }
    this.lastCheck = Date.now();
    return this.available;
  }

  async isAvailable(): Promise<boolean> {
    if (Date.now() - this.lastCheck < 1000 && this.lastCheck > 0) return this.available;
    return this.ping();
  }

  mark(stored: boolean): void {
    this.available = stored;
    this.lastCheck = Date.now();
  }

  async putReplay(runId: string, bytes: Buffer, sha256: string): Promise<boolean> {
    const key = `replays/${runId}.json`;
    const path = `/${this.cfg.s3.bucket}/${key}`;
    try {
      const r = await this.s3Request('PUT', path, bytes, {
        'content-type': 'application/json',
        'x-amz-meta-sha256': sha256
      });
      this.mark(r.status === 200);
      return r.status === 200;
    } catch {
      this.mark(false);
      return false;
    }
  }

  async getReplay(runId: string): Promise<Buffer | null> {
    const key = `replays/${runId}.json`;
    const path = `/${this.cfg.s3.bucket}/${key}`;
    try {
      const r = await this.s3Request('GET', path, Buffer.alloc(0));
      if (r.status === 200) {
        this.mark(true);
        return r.body;
      }
      if (r.status === 404) {
        this.mark(true);
        return null;
      }
      this.mark(r.status >= 500);
      return null;
    } catch {
      this.mark(false);
      return null;
    }
  }
}
