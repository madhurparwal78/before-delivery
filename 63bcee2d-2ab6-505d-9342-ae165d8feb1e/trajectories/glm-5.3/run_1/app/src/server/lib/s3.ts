// Minimal S3 client over fetch with AWS SigV4 (PUT/GET/DELETE only).

import { createHash, createHmac } from 'node:crypto';

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export class Storage {
  constructor(private config: S3Config) {}

  private hostOf(url: URL): string {
    if (this.config.forcePathStyle) {
      return url.host;
    }
    return `${this.config.bucket}.${url.host}`;
  }

  private pathOf(key: string): string {
    if (this.config.forcePathStyle) {
      return `/${this.config.bucket}/${key}`;
    }
    return `/${key}`;
  }

  private sign(method: string, key: string, payload: Buffer, contentType?: string): { url: string; headers: Record<string, string> } {
    const endpointUrl = new URL(this.config.endpoint);
    const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = createHash('sha256').update(payload).digest('hex');
    const canonicalUri = this.pathOf(key).replace(/\/+/g, '/');
    const headers: Record<string, string> = {
      host: this.hostOf(endpointUrl),
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    if (contentType) headers['content-type'] = contentType;
    const sortedHeaderKeys = Object.keys(headers).sort();
    const canonicalHeaders = sortedHeaderKeys.map((h) => `${h}:${headers[h]}\n`).join('');
    const signedHeaders = sortedHeaderKeys.join(';');
    const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = `${dateStamp}/${this.config.region}/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
    const kDate = createHmac('sha256', `AWS4${this.config.secretAccessKey}`).update(dateStamp).digest();
    const kRegion = createHmac('sha256', kDate).update(this.config.region).digest();
    const kService = createHmac('sha256', kRegion).update('s3').digest();
    const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
    const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
    const authorization = `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const protocol = endpointUrl.protocol;
    return {
      url: `${protocol}//${headers.host}${canonicalUri}`,
      headers: { ...headers, authorization },
    };
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const { url, headers } = this.sign('PUT', key, body, contentType);
    const response = await fetch(url, { method: 'PUT', headers, body: new Uint8Array(body) });
    if (!response.ok) {
      throw new Error(`s3 put failed ${response.status}`);
    }
  }

  async get(key: string): Promise<Buffer> {
    const { url, headers } = this.sign('GET', key, Buffer.alloc(0));
    const response = await fetch(url, { method: 'GET', headers });
    if (!response.ok) {
      throw new Error(`s3 get failed ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async ensureBucket(): Promise<void> {
    // MinIO in path-style mode; a HEAD bucket via the same signing.
    const endpointUrl = new URL(this.config.endpoint);
    const url = `${endpointUrl.protocol}//${endpointUrl.host}/${this.config.bucket}/`;
    const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = createHash('sha256').update('').digest('hex');
    const headers: Record<string, string> = {
      host: endpointUrl.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    const sortedHeaderKeys = Object.keys(headers).sort();
    const canonicalHeaders = sortedHeaderKeys.map((h) => `${h}:${headers[h]}\n`).join('');
    const signedHeaders = sortedHeaderKeys.join(';');
    const canonicalRequest = ['HEAD', `/${this.config.bucket}/`, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = `${dateStamp}/${this.config.region}/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
    const kDate = createHmac('sha256', `AWS4${this.config.secretAccessKey}`).update(dateStamp).digest();
    const kRegion = createHmac('sha256', kDate).update(this.config.region).digest();
    const kService = createHmac('sha256', kRegion).update('s3').digest();
    const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
    const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
    const authorization = `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const head = await fetch(url, { method: 'HEAD', headers: { ...headers, authorization } });
    if (head.ok) return;
    const put = await fetch(url, { method: 'PUT', headers: { ...headers, authorization: authorization.replace(`Credential=${this.config.accessKeyId}`, `Credential=${this.config.accessKeyId}`) } });
    if (!put.ok) throw new Error(`bucket ensure failed ${put.status}`);
  }
}
