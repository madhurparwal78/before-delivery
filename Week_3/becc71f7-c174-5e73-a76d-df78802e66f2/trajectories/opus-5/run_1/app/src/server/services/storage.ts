/**
 * MinIO, reached with signed S3 requests. The app serves photos and files to the browser
 * itself, so nothing here is ever exposed as a pre-signed address.
 */

import { createHash, createHmac } from 'node:crypto';
import type { Config } from '../config.js';

export class StorageUnavailable extends Error {
  constructor(cause?: unknown) {
    super('MinIO is unreachable');
    this.name = 'StorageUnavailable';
    this.cause = cause;
  }
}

export interface StoredObject {
  body: Buffer;
  contentType: string;
}

const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

function encodeKey(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

export class Storage {
  private readonly endpoint: URL;

  constructor(private readonly config: Config['s3']) {
    this.endpoint = new URL(config.endpoint);
  }

  get bucket(): string {
    return this.config.bucket;
  }

  private sign(
    method: string,
    path: string,
    query: string,
    payloadHash: string,
    extraHeaders: Record<string, string>,
  ): { url: string; headers: Record<string, string> } {
    const now = new Date();
    const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
    const dateStamp = amzDate.slice(0, 8);
    const host = this.endpoint.host;

    const headers: Record<string, string> = {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...extraHeaders,
    };
    const sortedNames = Object.keys(headers)
      .map((name) => name.toLowerCase())
      .sort();
    const canonicalHeaders = sortedNames
      .map((name) => {
        const value = Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1] ?? '';
        return `${name}:${value.trim().replace(/\s+/g, ' ')}\n`;
      })
      .join('');
    const signedHeaders = sortedNames.join(';');

    const canonicalRequest = [
      method,
      path,
      query,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const scope = `${dateStamp}/${this.config.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');

    const signingKey = hmac(
      hmac(hmac(hmac(`AWS4${this.config.secretAccessKey}`, dateStamp), this.config.region), 's3'),
      'aws4_request',
    );
    const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

    headers['authorization'] =
      `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    delete headers['host'];

    return {
      url: `${this.endpoint.origin}${path}${query === '' ? '' : `?${query}`}`,
      headers,
    };
  }

  private async send(
    method: string,
    path: string,
    query: string,
    body: Uint8Array | null,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    const payloadHash =
      body === null ? EMPTY_SHA256 : createHash('sha256').update(body).digest('hex');
    const { url, headers } = this.sign(method, path, query, payloadHash, extraHeaders);
    try {
      return await fetch(url, {
        method,
        headers,
        body: body === null ? undefined : body,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new StorageUnavailable(error);
    }
  }

  private objectPath(key: string): string {
    return this.config.forcePathStyle
      ? `/${encodeKey(this.config.bucket)}/${encodeKey(key)}`
      : `/${encodeKey(key)}`;
  }

  async ensureBucket(): Promise<void> {
    const bucketPath = `/${encodeKey(this.config.bucket)}`;
    const head = await this.send('HEAD', bucketPath, '', null);
    if (head.ok) return;
    if (head.status !== 404) throw new StorageUnavailable(`HEAD bucket answered ${head.status}`);
    const created = await this.send('PUT', bucketPath, '', new Uint8Array(0));
    if (!created.ok && created.status !== 409) {
      throw new StorageUnavailable(`PUT bucket answered ${created.status}`);
    }
  }

  async putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
    const response = await this.send('PUT', this.objectPath(key), '', body, {
      'content-type': contentType,
    });
    if (!response.ok) throw new StorageUnavailable(`PUT ${key} answered ${response.status}`);
    await response.arrayBuffer();
  }

  async getObject(key: string): Promise<StoredObject | null> {
    const response = await this.send('GET', this.objectPath(key), '', null);
    if (response.status === 404) {
      await response.arrayBuffer();
      return null;
    }
    if (!response.ok) throw new StorageUnavailable(`GET ${key} answered ${response.status}`);
    return {
      body: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    };
  }

  /** Whether MinIO holds the object, used to confirm a stored bank file. */
  async objectExists(key: string): Promise<boolean> {
    const response = await this.send('HEAD', this.objectPath(key), '', null);
    if (response.status === 404) return false;
    if (!response.ok) throw new StorageUnavailable(`HEAD ${key} answered ${response.status}`);
    return true;
  }

  async deleteObject(key: string): Promise<void> {
    const response = await this.send('DELETE', this.objectPath(key), '', null);
    if (!response.ok && response.status !== 404) {
      throw new StorageUnavailable(`DELETE ${key} answered ${response.status}`);
    }
    await response.arrayBuffer();
  }

  /** Every object key under a prefix, so an erasure can ask MinIO what it holds. */
  async listKeys(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | null = null;
    do {
      const query = [
        'list-type=2',
        `prefix=${encodeURIComponent(prefix)}`,
        ...(token === null ? [] : [`continuation-token=${encodeURIComponent(token)}`]),
      ]
        .sort()
        .join('&');
      const path = this.config.forcePathStyle ? `/${encodeKey(this.config.bucket)}` : '/';
      const response = await this.send('GET', path, query, null);
      if (!response.ok) {
        throw new StorageUnavailable(`LIST ${prefix} answered ${response.status}`);
      }
      const xml = await response.text();
      for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) {
        keys.push(decodeXml(match[1] ?? ''));
      }
      const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
      const next = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml);
      token = truncated && next !== null ? decodeXml(next[1] ?? '') : null;
    } while (token !== null);
    return keys;
  }
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, `'`)
    .replace(/&amp;/g, '&');
}

export const photoOriginalKey = (pieceId: string, photoId: string): string =>
  `pieces/${pieceId}/photos/${photoId}/original`;
export const photoPublicKey = (pieceId: string, photoId: string): string =>
  `pieces/${pieceId}/photos/${photoId}/public`;
export const piecePhotoPrefix = (pieceId: string): string => `pieces/${pieceId}/photos/`;
export const payoutFileKey = (month: string): string => `payouts/PAYOUT-${month}.xml`;
