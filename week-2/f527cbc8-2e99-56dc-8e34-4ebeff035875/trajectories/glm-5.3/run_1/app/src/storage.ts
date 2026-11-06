import crypto from 'node:crypto';
import { config } from './config.js';
import { connectDb, txQuery, type Tx, type Row } from './db.js';
import { now } from './time.js';

const METHOD = 'AWS4-HMAC-SHA256';
const ALGO = 'AWS4-HMAC-SHA256';
const UNSIGNABLE = ['authorization', 'content-length', 'user-agent', 'x-amz-content-sha256', 'expect'];

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

interface SigParts {
  method: string;
  path: string;
  query: Map<string, string>;
  headers: Array<[string, string]>;
  payloadHash: string;
  doubleEncode: boolean;
}

function canonicalHeaders(headers: Array<[string, string]>): string {
  return headers.map(([k, v]) => `${k}:${v.trim()}\n`).join('');
}

function signedHeaderList(headers: Array<[string, string]>): string {
  return headers.map(([k]) => k).join(';');
}

function canonicalQuery(query: Map<string, string>): string {
  const keys = [...query.keys()].sort();
  return keys.map(k => `${uriEncode(k, true)}=${uriEncode(query.get(k)!, true)}`).join('&');
}

function uriEncode(v: string, isParam: boolean): string {
  let out = '';
  for (const ch of v) {
    if (/[A-Za-z0-9-_.~]/.test(ch)) { out += ch; continue; }
    if (ch === '/') { out += isParam ? '%2F' : '/'; continue; }
    for (const b of Buffer.from(ch, 'utf8')) out += '%' + b.toString(16).toUpperCase();
  }
  return out;
}

function parseUrl(url: string): { host: string; port: string; path: string; query: Map<string, string> } {
  const u = new URL(url);
  const query = new Map<string, string>();
  u.searchParams.forEach((v, k) => query.set(k, v));
  return {
    host: u.hostname,
    port: u.port || (u.protocol === 'https:' ? '443' : '80'),
    path: u.pathname,
    query
  };
}

async function signAndFetch(parts: SigParts, body: Buffer, timeoutMs: number): Promise<Response> {
  const p = parseUrl(config.s3Endpoint);
  const hostHeader = p.port === '80' || p.port === '443' ? p.host : `${p.host}:${p.port}`;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const payloadHash = sha256Hex(body);
  const headers: Array<[string, string]> = [['host', hostHeader], ['x-amz-date', amzDate], ['x-amz-content-sha256', payloadHash]];
  for (const [k, v] of parts.headers) {
    const lk = k.toLowerCase();
    if (UNSIGNABLE.includes(lk) || lk.startsWith('x-amz-date')) continue;
    headers.push([lk, v]);
  }
  headers.sort((a, b) => a[0].localeCompare(b[0]));
  const signedHeaders = signedHeaderList(headers);
  const canonicalRequest = [
    parts.method,
    parts.doubleEncode ? parts.path.split('/').map(seg => seg ? uriEncode(decodeURIComponent(seg), false) : '').join('/') : parts.path,
    canonicalQuery(parts.query),
    canonicalHeaders(headers),
    signedHeaders,
    payloadHash
  ].join('\n');
  const scope = `${amzDate.slice(0, 8)}/${config.s3Region}/s3/aws4_request`;
  const stringToSign = [ALGO, amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${config.s3SecretAccessKey}`, amzDate.slice(0, 8));
  const kRegion = hmac(kDate, config.s3Region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  const authorization = `${METHOD} Credential=${config.s3AccessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = `${config.s3Endpoint}${parts.path}${parts.query.size > 0 ? '?' + canonicalQuery(parts.query) : ''}`;
  const h: Record<string, string> = {};
  for (const [k, v] of headers) h[k] = v;
  h['authorization'] = authorization;
  return await fetch(url, {
    method: parts.method,
    headers: h,
    body: parts.method === 'GET' || parts.method === 'HEAD' || parts.method === 'DELETE' ? undefined : body,
    signal: AbortSignal.timeout(timeoutMs)
  });
}

export class StorageUnavailable extends Error {}

async function call(method: string, key: string, body: Buffer, headers: Array<[string, string]> | undefined, query: Map<string, string>, timeoutMs = 8000): Promise<Response> {
  try {
    const res = await signAndFetch({ method, path: `/${config.s3Bucket}/${key}`, query, headers: headers ?? [], payloadHash: '', doubleEncode: false }, body, timeoutMs);
    return res;
  } catch {
    throw new StorageUnavailable();
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const res = await call('PUT', key, body, [['content-type', contentType]], new Map());
  if (!(res.status >= 200 && res.status < 300)) {
    const t = await res.text().catch(() => '');
    if (res.status >= 500) throw new StorageUnavailable();
    throw new Error(`minio put ${res.status} ${t.slice(0, 200)}`);
  }
}

export async function getObject(key: string): Promise<Buffer | null> {
  const res = await call('GET', key, Buffer.alloc(0), undefined, new Map());
  if (res.status === 404) return null;
  if (res.status >= 500) throw new StorageUnavailable();
  if (!(res.status >= 200 && res.status < 300)) return null;
  return Buffer.from(await res.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const res = await call('DELETE', key, Buffer.alloc(0), undefined, new Map());
  if (res.status >= 500) throw new StorageUnavailable();
}

export async function deletePrefix(prefix: string): Promise<void> {
  let marker: string | null = null;
  for (let i = 0; i < 100; i++) {
    const query = new Map([['list-type', '2'], ['prefix', prefix], ['max-keys', '1000']]);
    if (marker) query.set('start-after', marker);
    const res = await call('GET', '', Buffer.alloc(0), undefined, query);
    if (res.status >= 500) throw new StorageUnavailable();
    if (!(res.status >= 200 && res.status < 300)) return;
    const text = await res.text();
    const keys = [...text.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1]);
    for (const k of keys) await deleteObject(k);
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(text);
    if (!truncated || keys.length === 0) return;
    marker = keys[keys.length - 1];
  }
}

export async function ensureBucket(): Promise<void> {
  try {
    const res = await call('GET', '', Buffer.alloc(0), undefined, new Map([['location', '']]));
    if (res.status === 404) {
      await call('PUT', '', Buffer.alloc(0), undefined, new Map());
    }
  } catch {
    // bucket check at boot is best-effort; readiness reports the state
  }
}

export async function storageUp(): Promise<boolean> {
  try {
    const res = await call('GET', '', Buffer.alloc(0), undefined, new Map([['location', '']]));
    return res.status < 500;
  } catch {
    return false;
  }
}
