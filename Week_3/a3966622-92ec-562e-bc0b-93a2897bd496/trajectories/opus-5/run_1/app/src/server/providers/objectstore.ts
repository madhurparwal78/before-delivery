import { createHash, createHmac } from 'node:crypto';
import type { Config } from '../config.ts';

const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';
const REQUEST_TIMEOUT_MS = 5000;

export type StoredObject = { body: Buffer; contentType: string };

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function stamps(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

/** MinIO over the S3 REST API, signed with Signature Version 4. */
export class ObjectStore {
  private readonly settings: Config['objectStore'];
  private bucketReady = false;

  constructor(settings: Config['objectStore']) {
    this.settings = settings;
  }

  private signedRequest(
    method: string,
    canonicalPath: string,
    body: Buffer,
    extraHeaders: Record<string, string>,
  ): { url: string; headers: Record<string, string> } {
    const endpoint = new URL(this.settings.endpoint);
    const { amzDate, dateStamp } = stamps(new Date());
    const payloadHash = sha256Hex(body);
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries({
      host: endpoint.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...extraHeaders,
    })) {
      headers[name.toLowerCase()] = value;
    }
    const sortedNames = Object.keys(headers).sort();
    const canonicalHeaders = sortedNames
      .map((name) => `${name}:${(headers[name] as string).trim()}\n`)
      .join('');
    const signedHeaders = sortedNames.join(';');
    const canonicalRequest = [
      method,
      canonicalPath,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');
    const scope = `${dateStamp}/${this.settings.region}/${SERVICE}/aws4_request`;
    const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
    const signingKey = hmac(
      hmac(hmac(hmac(`AWS4${this.settings.secretAccessKey}`, dateStamp), this.settings.region), SERVICE),
      'aws4_request',
    );
    const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
    headers.authorization = `${ALGORITHM} Credential=${this.settings.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return { url: `${endpoint.origin}${canonicalPath}`, headers };
  }

  private async send(
    method: string,
    canonicalPath: string,
    body: Buffer,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    const { url, headers } = this.signedRequest(method, canonicalPath, body, extraHeaders);
    return fetch(url, {
      method,
      headers,
      body: method === 'PUT' || method === 'POST' ? body : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  private bucketPath(): string {
    return `/${encodeSegment(this.settings.bucket)}`;
  }

  private objectPath(key: string): string {
    return `${this.bucketPath()}/${key.split('/').map(encodeSegment).join('/')}`;
  }

  /** The bucket is created, private, if it is absent. */
  async ensureBucket(): Promise<void> {
    if (this.bucketReady) return;
    const head = await this.send('HEAD', this.bucketPath(), Buffer.alloc(0));
    if (head.ok) {
      this.bucketReady = true;
      return;
    }
    if (head.status !== 404) throw new Error(`object store bucket check failed: ${head.status}`);
    const created = await this.send('PUT', this.bucketPath(), Buffer.alloc(0));
    if (!created.ok && created.status !== 409) {
      throw new Error(`object store bucket creation failed: ${created.status}`);
    }
    this.bucketReady = true;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.ensureBucket();
    const response = await this.send('PUT', this.objectPath(key), body, {
      'content-type': contentType,
    });
    if (!response.ok) throw new Error(`object store write failed: ${response.status}`);
    const etag = (response.headers.get('etag') ?? '').replace(/"/g, '');
    const md5 = createHash('md5').update(body).digest('hex');
    if (etag !== md5) throw new Error('object store did not confirm the written bytes');
  }

  async get(key: string): Promise<StoredObject> {
    await this.ensureBucket();
    const response = await this.send('GET', this.objectPath(key), Buffer.alloc(0));
    if (!response.ok) throw new Error(`object store read failed: ${response.status}`);
    return {
      body: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    };
  }

  async check(): Promise<boolean> {
    try {
      this.bucketReady = false;
      await this.ensureBucket();
      return true;
    } catch {
      return false;
    }
  }
}
