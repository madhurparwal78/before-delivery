/**
 * MinIO. Every file persists here byte for byte and is confirmed before any
 * screen says so. Credentials stay in this process.
 */
import { createHash, createHmac } from 'node:crypto';
import type { Config } from '../config.ts';

export class StorageUnavailable extends Error {
  constructor(cause?: unknown) {
    super('file store unavailable');
    this.name = 'StorageUnavailable';
    this.cause = cause;
  }
}

function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Uint8Array | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

export class Storage {
  private readonly base: URL;
  private bucketReady = false;

  constructor(private readonly config: Config) {
    this.base = new URL(config.s3.endpoint);
  }

  /** The object's SHA-256, used as its own key for photographs and workbooks. */
  static digest(bytes: Uint8Array): string {
    return sha256Hex(bytes);
  }

  private sign(
    method: string,
    objectPath: string,
    query: string,
    headers: Record<string, string>,
    payloadHash: string,
    now: Date,
  ): Record<string, string> {
    const { region, accessKeyId, secretAccessKey } = this.config.s3;
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);

    const signed: Record<string, string> = {
      ...headers,
      host: this.base.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    const names = Object.keys(signed)
      .map((n) => n.toLowerCase())
      .sort();
    const canonicalHeaders = names.map((n) => `${n}:${String(signed[n] ?? signed[n.toLowerCase()]).trim()}\n`).join('');
    const signedHeaders = names.join(';');

    const canonicalRequest = [
      method,
      objectPath,
      query,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const scope = `${dateStamp}/${region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      sha256Hex(canonicalRequest),
    ].join('\n');

    const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), 's3'), 'aws4_request');
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    signed.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return signed;
  }

  private async call(
    method: string,
    key: string | null,
    body: Uint8Array | null,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    const { bucket, forcePathStyle } = this.config.s3;
    const objectPath = forcePathStyle
      ? `/${bucket}${key === null ? '' : `/${encodePath(key)}`}`
      : `${key === null ? '/' : `/${encodePath(key)}`}`;
    const url = new URL(objectPath, this.base);
    if (!forcePathStyle) url.host = `${bucket}.${this.base.host}`;

    const payloadHash = body ? sha256Hex(body) : sha256Hex('');
    const headers = this.sign(
      method,
      objectPath,
      '',
      body ? { ...extraHeaders, 'content-length': String(body.length) } : extraHeaders,
      payloadHash,
      new Date(),
    );

    try {
      return await fetch(url, {
        method,
        headers,
        body: body ? Buffer.from(body) : undefined,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (cause) {
      throw new StorageUnavailable(cause);
    }
  }

  /** Makes the bucket when it is missing. */
  async ensureBucket(): Promise<void> {
    if (this.bucketReady) return;
    const head = await this.call('HEAD', null, null);
    if (head.ok) {
      this.bucketReady = true;
      return;
    }
    if (head.status !== 404) throw new StorageUnavailable(`bucket status ${head.status}`);
    const made = await this.call('PUT', null, null);
    if (!made.ok && made.status !== 409) throw new StorageUnavailable(`bucket create ${made.status}`);
    this.bucketReady = true;
  }

  /** Writes the bytes and confirms them before returning. */
  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.ensureBucket();
    const res = await this.call('PUT', key, bytes, { 'content-type': contentType });
    if (!res.ok) throw new StorageUnavailable(`put ${res.status}`);
    await res.arrayBuffer();
  }

  async get(key: string): Promise<Uint8Array | null> {
    await this.ensureBucket();
    const res = await this.call('GET', key, null);
    if (res.status === 404) {
      await res.arrayBuffer();
      return null;
    }
    if (!res.ok) throw new StorageUnavailable(`get ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async has(key: string): Promise<boolean> {
    await this.ensureBucket();
    const res = await this.call('HEAD', key, null);
    if (res.status === 404) return false;
    if (!res.ok) throw new StorageUnavailable(`head ${res.status}`);
    return true;
  }

  /** Deletes an object, treating an absent one as deleted. */
  async remove(key: string): Promise<void> {
    await this.ensureBucket();
    const res = await this.call('DELETE', key, null);
    await res.arrayBuffer();
    if (!res.ok && res.status !== 404) throw new StorageUnavailable(`delete ${res.status}`);
  }

  async reachable(): Promise<boolean> {
    try {
      await this.ensureBucket();
      return true;
    } catch {
      return false;
    }
  }
}

export const storageKeys = {
  photograph: (deskId: string, pieceId: string, sha256: string): string =>
    `photographs/${deskId}/${pieceId}/${sha256}`,
  label: (deskId: string, pieceId: string, collectionId: string): string =>
    `labels/${deskId}/${pieceId}/${collectionId}.pdf`,
  workbook: (deskId: string, sha256: string): string => `workbooks/${deskId}/${sha256}.csv`,
  dossier: (deskId: string, pieceId: string, dossierId: string): string =>
    `dossiers/${deskId}/${pieceId}/${dossierId}.pdf`,
};
