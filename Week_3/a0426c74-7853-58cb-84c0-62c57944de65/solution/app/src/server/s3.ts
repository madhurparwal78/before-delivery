import { createHash, createHmac } from 'node:crypto';
import { ApiError } from '../shared/errors.ts';
import * as copy from '../shared/copy.ts';
import { config } from './config.ts';

const REQUEST_TIMEOUT_MS = 5000;
const HEALTH_TIMEOUT_MS = 2000;
const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string): Buffer => createHmac('sha256', key).update(data).digest();
const encode = (text: string): string => encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

interface Call {
  method: 'GET' | 'PUT' | 'HEAD';
  /** object key, or null for the bucket itself */
  key: string | null;
  body?: Buffer;
  contentType?: string;
  timeoutMs?: number;
}

/**
 * The one bucket on MinIO, over HTTP with our own SigV4 signing. Any network error, timeout or 5xx answer is `storage_unavailable`,
 * and so is every call while the grading storage switch says down.
 */
class ObjectStore {
  private down = false;

  setDown(down: boolean): void {
    this.down = down;
  }

  async put(key: string, body: Buffer, contentType = 'application/octet-stream'): Promise<void> {
    const response = await this.send({ method: 'PUT', key, body, contentType });
    await response.body?.cancel();
    if (!response.ok) throw refused(response);
  }

  /** The object's bytes; `not_found` when the key does not exist. */
  async get(key: string): Promise<Buffer> {
    const response = await this.send({ method: 'GET', key });
    if (response.status === 404) throw new ApiError('not_found', copy.NOT_FOUND);
    if (!response.ok) throw refused(response);
    return Buffer.from(await response.arrayBuffer());
  }

  /** A fresh check that the bucket answers, within two seconds. */
  async reachable(): Promise<boolean> {
    try {
      return (await this.send({ method: 'HEAD', key: null, timeoutMs: HEALTH_TIMEOUT_MS })).ok;
    } catch (error) {
      if (error instanceof ApiError) return false;
      throw error;
    }
  }

  private async send(call: Call): Promise<Response> {
    if (this.down) throw unavailable();
    try {
      const response = await this.dispatch(call);
      if (response.status >= 500) throw refused(response);
      return response;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.warn('storage unreachable', call.method, call.key, reason(error));
      throw unavailable();
    }
  }

  private async dispatch(call: Call): Promise<Response> {
    const { url, host, canonicalPath } = this.locate(call.key);
    const body = call.body ?? Buffer.alloc(0);
    const payloadHash = call.body ? sha256(body) : EMPTY_SHA256;
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const day = amzDate.slice(0, 8);
    const scope = `${day}/${config.s3.region}/s3/aws4_request`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
    const canonical = [
      call.method, canonicalPath, '',
      `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`, signedHeaders, payloadHash,
    ].join('\n');
    const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
    let signingKey = hmac(`AWS4${config.s3.secretAccessKey}`, day);
    for (const part of [config.s3.region, 's3', 'aws4_request']) signingKey = hmac(signingKey, part);
    const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
    const headers: Record<string, string> = {
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
    if (call.contentType) headers['content-type'] = call.contentType;
    return fetch(url, {
      method: call.method, headers, body: call.method === 'PUT' ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(call.timeoutMs ?? REQUEST_TIMEOUT_MS),
    });
  }

  /** Path-style (`<endpoint>/<bucket>/<key>`) or, without S3_FORCE_PATH_STYLE, virtual-hosted style (`<bucket>.<host>/<key>`). */
  private locate(key: string | null): { url: string; host: string; canonicalPath: string } {
    const endpoint = new URL(config.s3.endpoint);
    const keyPath = key === null ? '' : `/${key.split('/').map(encode).join('/')}`;
    const prefix = config.s3.forcePathStyle ? `/${encode(config.s3.bucket)}` : '';
    const host = config.s3.forcePathStyle ? endpoint.host : `${config.s3.bucket}.${endpoint.host}`;
    const canonicalPath = `${prefix}${keyPath}` || '/';
    return { url: `${endpoint.protocol}//${host}${canonicalPath}`, host, canonicalPath };
  }
}

/** One line for the log: the network failure's own message, never its stack. */
function reason(failure: unknown): string {
  const cause = failure instanceof Error && failure.cause instanceof Error ? failure.cause : failure;
  return cause instanceof Error ? cause.message : String(cause);
}

/** Storage answered with a status that is no success: the caller sees an outage, the log keeps the status. */
function refused(response: Response): ApiError {
  console.error('storage answered', response.status, response.url);
  return unavailable();
}

function unavailable(): ApiError {
  return new ApiError('storage_unavailable', copy.STORAGE_UNAVAILABLE);
}

export const s3 = new ObjectStore();
