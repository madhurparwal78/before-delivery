import crypto from 'node:crypto';
import type { Config } from '../config.ts';

export class StorageUnavailable extends Error {}

/**
 * S3-compatible storage client (AWS SigV4) with presigned GET links.
 * The bucket stays private; objects are served only through presigned links.
 */
export class Storage {
  constructor(private config: Config) {}

  private endpointHost(): string {
    const u = new URL(this.config.s3Endpoint);
    return u.host;
  }

  private base(): string {
    return this.config.s3Endpoint.replace(/\/$/, '');
  }

  private objectPath(key: string): string {
    return `/${this.config.s3Bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  private signingKey(dateStamp: string): Buffer {
    const kDate = crypto.createHmac('sha256', `AWS4${this.config.s3SecretAccessKey}`).update(dateStamp).digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(this.config.s3Region).digest();
    const kService = crypto.createHmac('sha256', kRegion).update('s3').digest();
    return crypto.createHmac('sha256', kService).update('aws4_request').digest();
  }

  private sha256Hex(data: Buffer | string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = this.sha256Hex(body);
    const path = this.objectPath(key);
    const canonicalHeaders = `host:${this.endpointHost()}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest = `PUT\n${path}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
    const scope = `${dateStamp}/${this.config.s3Region}/s3/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${this.sha256Hex(canonicalRequest)}`;
    const signature = crypto.createHmac('sha256', this.signingKey(dateStamp)).update(stringToSign).digest('hex');
    const authorization = `AWS4-HMAC-SHA256 Credential=${this.config.s3AccessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    let res: Response;
    try {
      res = await fetch(`${this.base()}${path}`, {
        method: 'PUT',
        headers: {
          Authorization: authorization,
          'x-amz-date': amzDate,
          'x-amz-content-sha256': payloadHash,
          'Content-Type': contentType,
          'Content-Length': String(body.length),
        },
        body: new Uint8Array(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new StorageUnavailable('storage unreachable');
    }
    if (!res.ok) throw new StorageUnavailable(`put failed ${res.status}`);
  }

  async head(key: string): Promise<boolean> {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = this.sha256Hex('');
    const path = this.objectPath(key);
    const canonicalHeaders = `host:${this.endpointHost()}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest = `HEAD\n${path}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
    const scope = `${dateStamp}/${this.config.s3Region}/s3/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${this.sha256Hex(canonicalRequest)}`;
    const signature = crypto.createHmac('sha256', this.signingKey(dateStamp)).update(stringToSign).digest('hex');
    const authorization = `AWS4-HMAC-SHA256 Credential=${this.config.s3AccessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    try {
      const res = await fetch(`${this.base()}${path}`, {
        method: 'HEAD',
        headers: { Authorization: authorization, 'x-amz-date': amzDate, 'x-amz-content-sha256': payloadHash },
        signal: AbortSignal.timeout(15_000),
      });
      return res.ok;
    } catch {
      throw new StorageUnavailable('storage unreachable');
    }
  }

  /** Presigned GET link valid for MEDIA_LINK_SECONDS. */
  presignGet(key: string): string {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const path = this.objectPath(key);
    const scope = `${dateStamp}/${this.config.s3Region}/s3/aws4_request`;
    const params: Array<[string, string]> = [
      ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
      ['X-Amz-Credential', `${this.config.s3AccessKeyId}/${scope}`],
      ['X-Amz-Date', amzDate],
      ['X-Amz-Expires', String(this.config.mediaLinkSeconds)],
      ['X-Amz-SignedHeaders', 'host'],
    ];
    const canonicalQuery = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    const canonicalRequest = `GET\n${path}\n${canonicalQuery}\nhost:${this.endpointHost()}\n\nhost\nUNSIGNED-PAYLOAD`;
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${this.sha256Hex(canonicalRequest)}`;
    const signature = crypto.createHmac('sha256', this.signingKey(dateStamp)).update(stringToSign).digest('hex');
    return `${this.base()}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  }
}
