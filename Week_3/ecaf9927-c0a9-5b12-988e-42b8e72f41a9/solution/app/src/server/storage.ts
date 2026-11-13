import { createHash, createHmac } from 'node:crypto';
import { config } from './config';

const EMPTY_HASH = createHash('sha256').update('').digest('hex');

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

/** AWS Signature Version 4 headers for one request to the object store. */
function sign(method: string, url: URL, body: Buffer | undefined, contentType: string | undefined): Record<string, string> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = body ? createHash('sha256').update(body).digest('hex') : EMPTY_HASH;
  const headers: Record<string, string> = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  if (contentType) headers['content-type'] = contentType;
  const names = Object.keys(headers).sort();
  const canonicalQuery = [...url.searchParams.entries()]
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonicalPath = url.pathname.split('/').map((segment) => encodeURIComponent(decodeURIComponent(segment))).join('/');
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join('');
  const canonical = `${method}\n${canonicalPath}\n${canonicalQuery}\n${canonicalHeaders}\n${names.join(';')}\n${payloadHash}`;
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonical).digest('hex')].join('\n');
  const signingKey = ['s3', 'aws4_request'].reduce(
    (key, part) => hmac(key, part),
    hmac(hmac(`AWS4${config.s3.secretAccessKey}`, day), config.s3.region),
  );
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
  };
}

function objectUrl(key: string, query = ''): URL {
  const endpoint = new URL(config.s3.endpoint);
  if (config.s3.forcePathStyle) return new URL(`${endpoint.origin}/${config.s3.bucket}/${key}${query}`);
  return new URL(`${endpoint.protocol}//${config.s3.bucket}.${endpoint.host}/${key}${query}`);
}

async function request(method: string, url: URL, timeoutMs: number, body?: Buffer, contentType?: string): Promise<Response> {
  const headers = sign(method, url, body, contentType);
  // The signed host header is set by fetch itself.
  delete (headers as Partial<Record<string, string>>)['host'];
  return fetch(url, { method, headers, body: body ? new Uint8Array(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
}

let lastCheck: { at: number; reachable: boolean } | undefined;
let inflight: Promise<boolean> | undefined;

function remember(reachable: boolean): void {
  lastCheck = { at: Date.now(), reachable };
}

/** Writes one body object; resolves true only once storage has confirmed the write. */
export async function putObject(key: string, payload: Buffer): Promise<boolean> {
  try {
    const response = await request('PUT', objectUrl(key), config.storageTimeoutMs, payload, 'application/json');
    await response.arrayBuffer();
    remember(response.ok);
    return response.ok;
  } catch {
    remember(false);
    return false;
  }
}

/** Reads one body object exactly as stored; undefined when storage cannot answer. */
export async function getObject(key: string): Promise<Buffer | undefined> {
  try {
    const response = await request('GET', objectUrl(key), config.storageTimeoutMs);
    if (!response.ok) {
      await response.arrayBuffer();
      return undefined;
    }
    remember(true);
    return Buffer.from(await response.arrayBuffer());
  } catch {
    remember(false);
    return undefined;
  }
}

async function probe(): Promise<boolean> {
  try {
    const response = await request('GET', objectUrl('', '?list-type=2&max-keys=1'), 2000);
    await response.arrayBuffer();
    return response.ok;
  } catch {
    return false;
  }
}

/** Whether storage answered a check made within the last few seconds; checks again when the last one is older. */
export async function storageReachable(): Promise<boolean> {
  if (lastCheck && Date.now() - lastCheck.at < config.storageStatusMaxAgeMs) return lastCheck.reachable;
  inflight ??= probe().then((reachable) => {
    remember(reachable);
    inflight = undefined;
    return reachable;
  });
  return inflight;
}
