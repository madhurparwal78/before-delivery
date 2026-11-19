import { createHash, createHmac } from 'node:crypto';
/**
 * Minimal S3 client over signed fetch requests. Uses the AWS SigV4
 * algorithm against the configured S3_ENDPOINT; no SDK dependency.
 */

interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export interface PutResult {
  ok: boolean;
}

export interface GetResult {
  ok: boolean;
  bytes: Buffer | null;
}

export class StorageUnavailable extends Error {}

const sha256Hex = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');
const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data).digest();

function amzDate(d = new Date()): { amz: string; date: string } {
  const iso = d.toISOString();
  const amz = `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
  return { amz, date: amz.slice(0, 8) };
}

export class S3 {
  cfg: S3Config;

  constructor(cfg: S3Config) { this.cfg = cfg; }

  private url(key: string): URL {
    if (this.cfg.forcePathStyle) {
      return new URL(`${this.cfg.endpoint.replace(/\/$/, '')}/${this.cfg.bucket}/${key}`);
    }
    const u = new URL(this.cfg.endpoint);
    return new URL(`${u.protocol}//${this.cfg.bucket}.${u.host}/${key}`);
  }

  private async signedFetch(method: string, key: string, body: Buffer | null, contentType?: string, timeoutMs = 3000): Promise<Response> {
    const url = this.url(key);
    const { amz, date } = amzDate();
    const payloadHash = sha256Hex(body ?? Buffer.alloc(0));
    const headers: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amz,
    };
    if (contentType) headers['content-type'] = contentType;
    const signedHeadersList = Object.keys(headers).sort().join(';');
    const canonicalHeaders = Object.keys(headers).sort().map((h) => `${h}:${headers[h]}\n`).join('');
    const canonicalRequest = [method, url.pathname, url.search.replace('?', ''), canonicalHeaders, signedHeadersList, payloadHash].join('\n');
    const scope = `${date}/${this.cfg.region}/s3/aws4_request`;
    const toSign = ['AWS4-HMAC-SHA256', amz, scope, sha256Hex(canonicalRequest)].join('\n');
    const kDate = hmac(`AWS4${this.cfg.secretAccessKey}`, date);
    const kRegion = hmac(kDate, this.cfg.region);
    const kService = hmac(kRegion, 's3');
    const kSigning = hmac(kService, 'aws4_request');
    const signature = createHmac('sha256', kSigning).update(toSign).digest('hex');
    const authorization = `AWS4-HMAC-SHA256 Credential=${this.cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeadersList}, Signature=${signature}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetch(url, {
        method,
        headers: { ...headers, authorization },
        body: body ? new Uint8Array(body) : undefined,
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(t);
    }
  }

  async ensureBucket(): Promise<void> {
    const exists = await this.signedFetch('HEAD', '', null);
    if (exists.ok) return;
    await this.signedFetch('PUT', '', null);
  }

  async put(key: string, body: Buffer, contentType: string): Promise<PutResult> {
    const res = await this.signedFetch('PUT', key, body, contentType);
    if (!res.ok) return { ok: false };
    // Verify the object exists right after writing.
    const check = await this.signedFetch('HEAD', key, null);
    return { ok: check.ok };
  }

  async get(key: string): Promise<GetResult> {
    const res = await this.signedFetch('GET', key, null);
    if (!res.ok) return { ok: false, bytes: null };
    const buf = Buffer.from(await res.arrayBuffer());
    return { ok: true, bytes: buf };
  }

  async exists(key: string): Promise<boolean> {
    const res = await this.signedFetch('HEAD', key, null);
    return res.ok;
  }
}

export function storageFromEnv(): S3 | null {
  const endpoint = process.env.S3_ENDPOINT;
  const bucket = process.env.S3_BUCKET;
  const accessKey = process.env.S3_ACCESS_KEY_ID;
  const secretKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKey || !secretKey) return null;
  return new S3({
    endpoint,
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket,
    accessKeyId: accessKey,
    secretAccessKey: secretKey,
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
  });
}

/** A storage wrapper honouring the grading switch and boot state. */
export interface StorageState {
  s3: S3 | null;
  down: boolean; // grading switch
}

export function makeStorage(): StorageState {
  return { s3: storageFromEnv(), down: false };
}

export async function storageCall<T>(state: StorageState, fn: (s3: S3) => Promise<T>): Promise<T | null> {
  if (state.down || !state.s3) return null;
  try {
    return await fn(state.s3);
  } catch {
    return null;
  }
}

export async function storageHealthy(state: StorageState): Promise<boolean> {
  if (!state.s3 || state.down) return false;
  try {
    const res = await state.s3.exists('');
    return res;
  } catch {
    return false;
  }
}

export function attachmentKey(mapId: string, sha: string, type: 'png' | 'jpg'): string {
  return `attachments/${mapId}/${sha}.${type}`;
}

export function importKey(mapId: string, sha: string): string {
  return `imports/${mapId}/${sha}.sprig.txt`;
}

export function exportKey(mapId: string, jobId: string, format: 'sprig' | 'svg'): string {
  return `exports/${mapId}/${jobId}.${format === 'sprig' ? 'sprig.txt' : 'svg'}`;
}

export function versionKey(mapId: string, versionId: string): string {
  return `versions/${mapId}/${versionId}.json`;
}

export { sha256Hex as sha256 };
