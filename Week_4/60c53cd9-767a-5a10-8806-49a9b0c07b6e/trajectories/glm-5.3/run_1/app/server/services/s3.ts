// MinIO S3 client: AWS Signature V4 over the plain XML API, with the single-part
// PUT, GET, HEAD and DELETE operations the app needs.
import { createHash, createHmac } from 'node:crypto';
import { request as httpRequest } from 'node:http';

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface S3Object {
  key: string;
  size: number;
  etag: string;
  body?: Buffer;
}

export class S3Client {
  constructor(private readonly config: S3Config) {}

  private endpointParts(): { host: string; port: number; protocol: string; path: string } {
    const url = new URL(this.config.endpoint);
    return {
      host: url.hostname,
      port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
      protocol: url.protocol.replace(':', ''),
      path: url.pathname.replace(/\/$/, ''),
    };
  }

  private requestHeaders(): Record<string, string> {
    return {
      host: `${this.endpointParts().host}:${this.endpointParts().port}`,
    };
  }

  private uriEncode(value: string): string {
    return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  }

  private signHeaders(method: string, key: string, payloadHash: string, extraHeaders: Record<string, string> = {}): { headers: Record<string, string>; path: string } {
    const { host, port } = this.endpointParts();
    const hostHeader = `${host}:${port}`;
    const canonicalUri = `/${this.config.bucket}/${key.split('/').map((p) => this.uriEncode(p)).join('/')}`;
    const amzDate = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '').replace('Z', 'Z');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHeader = `x-amz-content-sha256:${payloadHash}\n`;
    const headers: Record<string, string> = {
      host: hostHeader,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...extraHeaders,
    };
    const sortedKeys = Object.keys(headers).sort();
    const canonicalHeaders = sortedKeys.map((h) => `${h}:${headers[h].trim()}\n`).join('');
    const signedHeaders = sortedKeys.join(';');
    const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = `${dateStamp}/${this.config.region}/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
    const kDate = createHmac('sha256', `AWS4${this.config.secretAccessKey}`).update(dateStamp).digest();
    const kRegion = createHmac('sha256', kDate).update(this.config.region).digest();
    const kService = createHmac('sha256', kRegion).update('s3').digest();
    const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
    const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return { headers, path: canonicalUri };
  }

  private perform(method: string, key: string, body: Buffer | null, extraHeaders: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }> {
    const payloadHash = createHash('sha256').update(body ?? Buffer.alloc(0)).digest('hex');
    const { headers, path } = this.signHeaders(method, key, payloadHash, extraHeaders);
    const { host, port } = this.endpointParts();
    const payload = body ?? Buffer.alloc(0);
    headers['content-length'] = String(payload.length);
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          host,
          port,
          method,
          path,
          headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.perform('PUT', key, body, { 'content-type': contentType });
  }

  async getObject(key: string): Promise<S3Object | null> {
    const result = await this.perform('GET', key, null);
    if (result.status !== 200) return null;
    return { key, size: result.body.length, etag: (result.headers.etag as string ?? '').replace(/"/g, ''), body: result.body };
  }

  async headObject(key: string): Promise<S3Object | null> {
    const result = await this.perform('HEAD', key, null);
    if (result.status !== 200) return null;
    const length = Number(result.headers['content-length'] ?? 0);
    const etag = (result.headers.etag as string ?? '').replace(/"/g, '');
    return { key, size: length, etag };
  }

  async deleteObject(key: string): Promise<void> {
    await this.perform('DELETE', key, null);
  }

  async objectExists(key: string): Promise<boolean> {
    const head = await this.headObject(key).catch(() => null);
    return head !== null;
  }

  async ensureBucket(): Promise<void> {
    const { host, port } = this.endpointParts();
    const head = await new Promise<number>((resolve, reject) => {
      const req = httpRequest({ host, port, method: 'HEAD', path: `/${this.config.bucket}`, headers: {} }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      });
      req.on('error', reject);
      req.end();
    }).catch(() => 0);
    if (head === 200) return;
    await new Promise<void>((resolve) => {
      const req = httpRequest({ host, port, method: 'PUT', path: `/${this.config.bucket}`, headers: { 'content-length': '0' } }, () => resolve());
      req.on('error', () => resolve());
      req.end();
    });
  }
}
