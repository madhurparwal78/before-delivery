/**
 * Object storage: one place talks S3, with AWS Signature V4, path-style or
 * virtual-host addressing, and a 10 second limit per call.
 */
import { createHash, createHmac } from 'node:crypto';
import { request } from 'node:http';

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export class StorageError extends Error {
  constructor(readonly missing: boolean) {
    super(missing ? 'object missing' : 'storage unreachable');
  }
}

const sha256hex = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');

const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac('sha256', Buffer.from(key)).update(data, 'utf8').digest();

function sign(key: string | Buffer, date: string, region: string, service: string): Buffer {
  const kDate = hmac(key, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

interface Target {
  host: string;
  connectHost: string;
  port: number;
  path: string;
}

function urlFor(config: S3Config, key: string): Target {
  const url = new URL(config.endpoint);
  const hostOnly = url.hostname;
  const port = url.port ? parseInt(url.port, 10) : url.protocol === 'https:' ? 443 : 80;
  if (config.forcePathStyle) {
    return {
      host: hostOnly,
      connectHost: hostOnly,
      port,
      path: `/${config.bucket}/${key}`,
    };
  }
  return {
    host: `${config.bucket}.${hostOnly}`,
    connectHost: `${config.bucket}.${hostOnly}`,
    port,
    path: `/${key}`,
  };
}

export interface S3Call {
  method: string;
  key: string;
  body?: Buffer;
  contentType?: string;
}

async function s3Request(
  config: S3Config,
  call: S3Call,
): Promise<{ status: number; body: Buffer }> {
  const { host, connectHost, port, path } = urlFor(config, call.key);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256hex(call.body ?? Buffer.alloc(0));
  const canonicalHeaders = [
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
  ].join('\n');
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    call.method,
    path,
    '',
    canonicalHeaders + '\n',
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${date}/${config.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const signingKey = sign(`AWS4${config.secretAccessKey}`, date, config.region, 's3');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  const headers: Record<string, string> = {
    Host: host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (call.contentType) headers['Content-Type'] = call.contentType;
  if (call.body) headers['Content-Length'] = String(call.body.length);

  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: connectHost,
        port,
        path,
        method: call.method,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) });
        });
      },
    );
    req.setTimeout(10_000, () => req.destroy(new StorageError(false)));
    req.on('error', (err) => reject(err instanceof StorageError ? err : new StorageError(false)));
    if (call.body) req.write(call.body);
    req.end();
  });
}

export class Storage {
  constructor(readonly config: S3Config) {}

  async headBucket(): Promise<boolean> {
    try {
      const res = await s3Request(this.config, { method: 'HEAD', key: '' });
      return res.status === 200;
    } catch {
      throw new StorageError(false);
    }
  }

  async createBucket(): Promise<void> {
    try {
      const res = await s3Request(this.config, { method: 'PUT', key: '' });
      // MinIO answers 200 when it creates the bucket and 409 when it exists
      if (res.status !== 200 && res.status !== 409) throw new StorageError(false);
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw new StorageError(false);
    }
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    try {
      const res = await s3Request(this.config, { method: 'PUT', key, body, contentType });
      if (res.status !== 200) throw new StorageError(false);
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw new StorageError(false);
    }
  }

  async getObject(key: string): Promise<Buffer> {
    try {
      const res = await s3Request(this.config, { method: 'GET', key });
      if (res.status === 200) return res.body;
      if (res.status === 404) throw new StorageError(true);
      throw new StorageError(false);
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw new StorageError(false);
    }
  }
}

export const objectKey = (documentId: string, exportId: string): string =>
  `exports/${documentId}/${exportId}.csv`;
