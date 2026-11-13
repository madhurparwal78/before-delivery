import { config } from './config.js';

// Plain fetch S3 client with AWS SigV4, avoiding the SDK's size.
import crypto from 'node:crypto';

function hmac(key: crypto.BinaryLike, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export interface PutOptions {
  contentType: string;
}

export class S3 {
  async put(key: string, body: Buffer, options: PutOptions): Promise<void> {
    await this.request('PUT', key, body, options);
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.request('GET', key, null);
    return response.body;
  }

  async stat(key: string): Promise<number | null> {
    const response = await this.request('HEAD', key, null);
    return response.contentLength;
  }

  async health(): Promise<boolean> {
    try {
      const response = await this.request('HEAD', 'health/probe', null, undefined, true);
      return response.status === 404;
    } catch {
      return false;
    }
  }

  private async request(
    method: string,
    key: string,
    body: Buffer | null,
    options?: PutOptions,
    isProbe = false,
  ): Promise<{ body: Buffer; status: number; contentLength: number | null }> {
    const cfg = config();
    const url = new URL(`${cfg.s3Endpoint}/${cfg.s3Bucket}/${key}`);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = body ? sha256Hex(body) : sha256Hex('');
    const canonicalHeaders =
      `host:${url.host}\n` +
      `x-amz-content-sha256:${payloadHash}\n` +
      `x-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest = [
      method,
      url.pathname,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');
    const scope = `${dateStamp}/${cfg.s3Region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      sha256Hex(canonicalRequest),
    ].join('\n');
    let signingKey: crypto.BinaryLike = `AWS4${cfg.s3SecretAccessKey}`;
    signingKey = hmac(signingKey, dateStamp);
    signingKey = hmac(signingKey, cfg.s3Region);
    signingKey = hmac(signingKey, 's3');
    signingKey = hmac(signingKey, 'aws4_request');
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
    const authorization =
      `AWS4-HMAC-SHA256 Credential=${cfg.s3AccessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const headers: Record<string, string> = {
      authorization,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    if (options?.contentType) headers['content-type'] = options.contentType;
    const response = await fetch(url, {
      method,
      headers,
      body: (body ?? undefined) as unknown as BodyInit,
      signal: AbortSignal.timeout(8000),
    });
    if (isProbe) {
      return { body: Buffer.alloc(0), status: response.status, contentLength: null };
    }
    if (!response.ok) {
      throw new Error(`s3 ${response.status} for ${key}`);
    }
    const lengthHeader = response.headers.get('content-length');
    return {
      body: Buffer.from(await response.arrayBuffer()),
      status: response.status,
      contentLength: lengthHeader ? Number.parseInt(lengthHeader, 10) : null,
    };
  }
}

export const s3 = new S3();
