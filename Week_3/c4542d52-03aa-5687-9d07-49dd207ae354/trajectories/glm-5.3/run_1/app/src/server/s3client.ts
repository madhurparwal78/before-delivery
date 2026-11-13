import crypto from 'node:crypto';

// A minimal S3 REST client for the document vault: PUT, GET and HEAD with
// AWS Signature Version 4, speaking plain HTTP to the MinIO endpoint.

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export class VaultError extends Error {
  constructor(message = "The document vault can't be reached. Try again shortly.") {
    super(message);
  }
}

const sha256Hex = (bytes: crypto.BinaryLike): string =>
  crypto.createHash('sha256').update(bytes).digest('hex');

const hmac = (key: crypto.BinaryLike, data: string): Buffer =>
  crypto.createHmac('sha256', key).update(data, 'utf8').digest();

/** Signs and performs one S3 request. */
async function s3Request(
  cfg: S3Config,
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE',
  objectKey: string,
  body?: Buffer,
  contentType?: string,
): Promise<{ status: number; headers: Map<string, string>; body: Buffer }> {
  const url = new URL(cfg.endpoint);
  const host = url.hostname;
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  const isDefaultPort = (url.protocol === 'https:' && port === 443) || (url.protocol === 'http:' && port === 80);
  const canonicalHost = isDefaultPort ? host : `${host}:${url.port}`;
  const path = `/${cfg.bucket}/${objectKey.split('/').map(encodeURIComponent).join('/')}`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body ?? Buffer.alloc(0));

  const headers: Array<[string, string]> = [
    ['host', canonicalHost],
    ['x-amz-content-sha256', payloadHash],
    ['x-amz-date', amzDate],
  ];
  if (contentType) headers.push(['content-type', contentType]);

  const signedHeaders = headers.map(([k]) => k).sort().join(';');
  const canonicalHeaders = [...headers].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k}:${v}\n`).join('');
  const canonicalRequest = [
    method, path, '', canonicalHeaders, signedHeaders, payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(Buffer.from(canonicalRequest, 'utf8')),
  ].join('\n');

  const kDate = hmac(`AWS4${cfg.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, cfg.region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const init: RequestInit & { body?: BodyInit } = {
      method,
      headers: {
        ...Object.fromEntries(headers.map(([k, v]) => [k, v])),
        Authorization: authorization,
      },
      signal: controller.signal,
    };
    if (method === 'PUT' && body) init.body = new Uint8Array(body);
    const res = await fetch(`${url.protocol}//${canonicalHost}${path}`, init);
    const resHeaders = new Map<string, string>();
    for (const [k, v] of res.headers.entries()) resHeaders.set(k.toLowerCase(), v);
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, headers: resHeaders, body: buf };
  } catch {
    throw new VaultError();
  } finally {
    clearTimeout(timer);
  }
}

/** Writes bytes once under the key and reads them back to verify. Returns the SHA-256. */
export async function s3PutVerified(cfg: S3Config, key: string, bytes: Buffer, contentType: string): Promise<string> {
  const put = await s3Request(cfg, 'PUT', key, bytes, contentType);
  if (put.status !== 200) throw new VaultError();
  const got = await s3Get(cfg, key);
  if (!got.body.equals(bytes)) throw new VaultError('The vault copy did not match.');
  return sha256Hex(got.body);
}

/** Reads the object's bytes. */
export async function s3Get(cfg: S3Config, key: string): Promise<{ body: Buffer; etag: string | null }> {
  const res = await s3Request(cfg, 'GET', key);
  if (res.status !== 200) throw new VaultError();
  return { body: res.body, etag: res.headers.get('etag') ?? null };
}

/** Answers whether the bucket exists and answers. */
export async function s3BucketExists(cfg: S3Config): Promise<boolean> {
  try {
    const res = await s3Request(cfg, 'HEAD', '');
    return res.status === 200;
  } catch {
    return false;
  }
}
