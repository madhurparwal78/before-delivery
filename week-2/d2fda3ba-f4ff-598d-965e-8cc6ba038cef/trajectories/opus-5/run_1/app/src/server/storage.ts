import { createHash, createHmac } from 'node:crypto';
import type { S3Config } from './config';

export class StorageUnavailableError extends Error {
  constructor(reason: string) {
    super(`object storage unavailable: ${reason}`);
  }
}

export interface StoredObject {
  body: Buffer;
  contentType: string;
}

export interface ObjectListing {
  key: string;
  size: number;
}

const REQUEST_TIMEOUT_MS = 4000;

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

export class ObjectStore {
  constructor(private readonly config: S3Config) {}

  private sign(
    method: string,
    canonicalPath: string,
    query: Record<string, string>,
    payload: Buffer | string,
    extraHeaders: Record<string, string>,
  ): { url: string; headers: Record<string, string> } {
    const now = new Date();
    const amzDate = `${now.toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`;
    const dateStamp = amzDate.slice(0, 8);
    const endpoint = new URL(this.config.endpoint);
    const payloadHash = sha256Hex(payload);

    const headers: Record<string, string> = { host: endpoint.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
    for (const [name, value] of Object.entries(extraHeaders)) headers[name.toLowerCase()] = value;

    const canonicalQuery = Object.keys(query)
      .sort()
      .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(query[key] ?? '')}`)
      .join('&');
    const headerNames = Object.keys(headers).sort();
    const canonicalHeaders = headerNames.map((name) => `${name}:${(headers[name] ?? '').trim()}\n`).join('');
    const signedHeaders = headerNames.join(';');

    const canonicalRequest = [
      method,
      canonicalPath,
      canonicalQuery,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const scope = `${dateStamp}/${this.config.region}/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${this.config.secretAccessKey}`, dateStamp), this.config.region), 's3'), 'aws4_request');
    const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const url = `${endpoint.origin}${canonicalPath}${canonicalQuery ? `?${canonicalQuery}` : ''}`;
    return { url, headers };
  }

  private canonicalPath(key: string | null): string {
    const base = this.config.forcePathStyle ? `/${this.config.bucket}` : '';
    return key === null ? `${base}/` : `${base}/${encodePath(key)}`;
  }

  private async send(
    method: string,
    key: string | null,
    query: Record<string, string>,
    payload: Buffer | string,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    const canonicalPath = this.canonicalPath(key);
    const { url, headers } = this.sign(method, canonicalPath, query, payload, extraHeaders);
    try {
      return await fetch(url, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : payload,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new StorageUnavailableError(error instanceof Error ? error.message : 'request failed');
    }
  }

  async put(key: string, body: Buffer | string, contentType: string): Promise<void> {
    const payload = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
    const response = await this.send('PUT', key, {}, payload, {
      'content-type': contentType,
    });
    if (!response.ok) throw new StorageUnavailableError(`put ${key} answered ${response.status}`);
    await response.arrayBuffer();
  }

  async get(key: string): Promise<StoredObject | null> {
    const response = await this.send('GET', key, {}, '');
    if (response.status === 404) {
      await response.arrayBuffer();
      return null;
    }
    if (!response.ok) throw new StorageUnavailableError(`get ${key} answered ${response.status}`);
    const body = Buffer.from(await response.arrayBuffer());
    return { body, contentType: response.headers.get('content-type') ?? 'application/octet-stream' };
  }

  async delete(key: string): Promise<void> {
    const response = await this.send('DELETE', key, {}, '');
    if (!response.ok && response.status !== 404) {
      throw new StorageUnavailableError(`delete ${key} answered ${response.status}`);
    }
    await response.arrayBuffer();
  }

  async list(prefix: string): Promise<ObjectListing[]> {
    const listings: ObjectListing[] = [];
    let token: string | null = null;
    do {
      const query: Record<string, string> = { 'list-type': '2', prefix };
      if (token) query['continuation-token'] = token;
      const response = await this.send('GET', null, query, '');
      if (!response.ok) throw new StorageUnavailableError(`list ${prefix} answered ${response.status}`);
      const xml = await response.text();
      for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const entry = match[1] ?? '';
        const key = /<Key>([\s\S]*?)<\/Key>/.exec(entry)?.[1];
        const size = /<Size>(\d+)<\/Size>/.exec(entry)?.[1];
        if (key) listings.push({ key: decodeXml(key), size: Number(size ?? 0) });
      }
      const truncated = /<IsTruncated>(true|false)<\/IsTruncated>/.exec(xml)?.[1] === 'true';
      token = truncated ? (/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1] ?? null) : null;
    } while (token);
    return listings;
  }

  async deletePrefix(prefix: string): Promise<number> {
    const listings = await this.list(prefix);
    for (const listing of listings) await this.delete(listing.key);
    return listings.length;
  }

  async ensureBucket(): Promise<void> {
    const head = await this.send('HEAD', null, {}, '');
    await head.arrayBuffer();
    if (head.ok) return;
    if (head.status !== 404) throw new StorageUnavailableError(`bucket check answered ${head.status}`);
    const created = await this.send('PUT', null, {}, '');
    await created.arrayBuffer();
    if (!created.ok && created.status !== 409) {
      throw new StorageUnavailableError(`bucket create answered ${created.status}`);
    }
  }
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function vaultBlobKey(vaultId: string, noteId: string, rev: number): string {
  return `vault-blobs/${vaultId}/${noteId}/${rev}.bin`;
}

export function publishPrefix(slug: string): string {
  return `publish/${slug}/`;
}

export function publishObjectKey(slug: string, publishId: string, key: string): string {
  return `publish/${slug}/${publishId}/${key}`;
}

export function previewPrefix(linkId: string): string {
  return `preview/${linkId}/`;
}

export function previewObjectKey(linkId: string, key: string): string {
  return `preview/${linkId}/${key}`;
}
