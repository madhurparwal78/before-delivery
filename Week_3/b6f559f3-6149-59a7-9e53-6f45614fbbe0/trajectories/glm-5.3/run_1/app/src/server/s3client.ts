// Minimal S3 client over request signing (AWS SigV4), no external SDK.
import { createHash, createHmac } from 'node:crypto';
import type { Config } from './config';

type S3Config = Config['s3'];

export interface S3Client {
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  headObject(key: string): Promise<{ size: number } | null>;
  getObject(key: string): Promise<Buffer | null>;
  bucketExists(): Promise<boolean>;
  createBucket(): Promise<void>;
  listObjects(prefix: string): Promise<string[]>;
  deleteObject(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
  reachable(): boolean;
}

export interface S3Status {
  ok: boolean;
  lastError: string | null;
}

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

export function makeS3Client(cfg: S3Config): { client: S3Client; status: S3Status } {
  const status: S3Status = { ok: false, lastError: null };
  const endpoint = new URL(cfg.endpoint);
  const host = endpoint.host; // includes port
  const proto = endpoint.protocol.replace(':', '');

  function sign(
    method: string,
    key: string,
    payloadHash: string,
    extraHeaders: Record<string, string> = {},
  ): { path: string; headers: Record<string, string> } {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const canonicalUri = `/${cfg.bucket}/${key
      .split('/')
      .map((s) => encodeURIComponent(s))
      .join('/')}`;
    const payload: Record<string, string> = {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...extraHeaders,
    };
    const sortedKeys = Object.keys(payload).sort();
    const canonicalHeaders = sortedKeys.map((k) => `${k}:${payload[k]}\n`).join('');
    const signedHeaders = sortedKeys.join(';');
    const canonicalRequest = [
      method,
      canonicalUri,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');
    const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      sha256Hex(canonicalRequest),
    ].join('\n');
    const kDate = hmac(`AWS4${cfg.secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, cfg.region);
    const kService = hmac(kRegion, 's3');
    const kSigning = hmac(kService, 'aws4_request');
    const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
    const auth = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return {
      path: canonicalUri,
      headers: { ...payload, Authorization: auth },
    };
  }

  async function request(
    method: string,
    key: string,
    body: Buffer | null,
    contentType: string,
  ): Promise<{ status: number; headers: Headers; data: Buffer }> {
    const payloadHash = sha256Hex(body ?? Buffer.alloc(0));
    const extra: Record<string, string> =
      method === 'PUT' && contentType ? { 'content-type': contentType } : {};
    const signed = sign(method, key, payloadHash, extra);
    const url = `${proto}://${host}${signed.path}`;
    const res = await fetch(url, {
      method,
      headers: signed.headers,
      body: body ?? undefined,
    });
    const data = Buffer.from(await res.arrayBuffer());
    return {
      status: res.status,
      headers: res.headers,
      data,
    };
  }

  async function tryMark<T>(fn: () => Promise<T>): Promise<T> {
    try {
      const r = await fn();
      status.ok = true;
      status.lastError = null;
      return r;
    } catch (e) {
      status.ok = false;
      status.lastError = e instanceof Error ? e.message : String(e);
      throw e;
    }
  }

  const client: S3Client = {
    async putObject(key, body, contentType) {
      await tryMark(async () => {
        const res = await request('PUT', key, body, contentType);
        if (res.status !== 200) throw new Error(`put failed: ${res.status}`);
      });
    },
    async headObject(key) {
      try {
        const res = await request('HEAD', key, null, '');
        if (res.status !== 200) return null;
        const len = res.headers.get('content-length');
        return { size: len ? Number(len) : 0 };
      } catch {
        return null;
      }
    },
    async getObject(key) {
      try {
        const res = await request('GET', key, null, '');
        if (res.status !== 200) return null;
        return res.data;
      } catch {
        return null;
      }
    },
    async bucketExists() {
      try {
        const res = await request('HEAD', '', null, '');
        return res.status === 200;
      } catch {
        return false;
      }
    },
    async createBucket() {
      await tryMark(async () => {
        const res = await request('PUT', '', null, '');
        // 200 OK, or the bucket already exists
        if (res.status !== 200 && res.status !== 409) {
          throw new Error(`create bucket failed: ${res.status}`);
        }
      });
    },
    async listObjects(prefix) {
      try {
        const url = `${proto}://${host}/${cfg.bucket}/?list-type=2&prefix=${encodeURIComponent(prefix)}`;
        const res = await fetch(url, { method: 'GET' });
        const xml = await res.text();
        const keys: string[] = [];
        const re = /<Key>([^<]+)<\/Key>/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(xml)) !== null) {
          keys.push(decodeURIComponent(m[1]!));
        }
        return keys;
      } catch {
        return [];
      }
    },
    async deleteObject(key) {
      try {
        await request('DELETE', key, null, '');
      } catch {
        // deleting a missing object is fine
      }
    },
    async deletePrefix(prefix) {
      const keys = await this.listObjects(prefix);
      for (const key of keys) {
        await this.deleteObject(key);
      }
    },
    reachable() {
      return status.ok;
    },
  };

  return { client, status };
}

export { sha256Hex };
