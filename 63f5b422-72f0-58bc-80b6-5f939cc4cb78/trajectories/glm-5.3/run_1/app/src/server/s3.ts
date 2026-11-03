// S3 calls in one place, with per-workspace outage simulation.
import crypto from 'node:crypto';
import { config } from './config.js';

export type ObjectBytes = { status: number; body: Buffer };

export class StorageUnavailable extends Error {
  constructor() { super('storage unavailable'); }
}

export function isStorageUnavailable(err: unknown): boolean {
  return err instanceof StorageUnavailable;
}

const outages = new Map<string, number>();

export function setStorageOutage(workspaceId: string, ms: number): void {
  outages.set(workspaceId, Date.now() + ms);
}

function outageActive(workspaceId: string): boolean {
  const until = outages.get(workspaceId);
  if (until === undefined) return false;
  if (until <= Date.now()) { outages.delete(workspaceId); return false; }
  return true;
}

function hmac(key: crypto.BinaryLike, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

export type S3Call = (
  method: 'GET' | 'PUT' | 'DELETE',
  path: string,
  body: Buffer | null,
  headers: Record<string, string>,
) => Promise<ObjectBytes>;

function encodeRfc3986(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

/** Path-style addressing: bucket in the path, keys URI-encoded per segment. */
function objectPath(path: string): string {
  return path.split('/').map(encodeRfc3986).join('/');
}

export function makeS3Call(workspaceId: string): S3Call {
  return async (method, path, body, headers) => {
    if (outageActive(workspaceId)) throw new StorageUnavailable();
    // paths carry only the object key; the bucket is always the first path segment
    const fullPath = path.startsWith(`/${config.s3.bucket}/`) ? path : `/${config.s3.bucket}${path.startsWith('/') ? '' : '/'}${path}`;
    const url = new URL(config.s3.endpoint + fullPath);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const credentialScope = `${dateStamp}/${config.s3.region}/s3/aws4_request`;
    const qp = new URLSearchParams();
    qp.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
    qp.set('X-Amz-Date', amzDate);
    qp.set('X-Amz-Credential', `${config.s3.accessKeyId}/${dateStamp}/${config.s3.region}/s3/aws4_request`);
    qp.set('X-Amz-Expires', '300');
    qp.set('X-Amz-SignedHeaders', 'host');
    const canonicalQuery = [...qp.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`).join('&');
    const canonicalHeaders = `host:${url.host}\n`;
    const canonicalRequest = [method, objectPath(fullPath), canonicalQuery, canonicalHeaders, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');
    const kDate = hmac(`AWS4${config.s3.secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, config.s3.region);
    const kService = hmac(kRegion, 's3');
    const kSigning = hmac(kService, 'aws4_request');
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
    const query = `${canonicalQuery}&X-Amz-Signature=${signature}`;
    const target = `${config.s3.endpoint}${objectPath(fullPath)}?${query}`;
    const fetchHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) if (v) fetchHeaders[k] = v;
    let res: Response;
    try {
      res = await fetch(target, { method, headers: fetchHeaders, body: body ? new Uint8Array(body) : undefined });
    } catch {
      throw new StorageUnavailable();
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (res.status === 404) return { status: 404, body: Buffer.alloc(0) };
    if (!res.ok) throw new Error(`s3 request failed: ${res.status}`);
    return { status: res.status, body: buf };
  };
}

export function imageKey(workspaceId: string, imageId: string): string {
  return `images/${workspaceId}/${imageId}`;
}

export function snapshotKey(pageId: string, publishId: string): string {
  return `snapshots/${pageId}/${publishId}.html`;
}

export function assetKey(pageId: string, publishId: string, imageId: string): string {
  return `snapshots/${pageId}/${publishId}/assets/${imageId}`;
}
