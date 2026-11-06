import { createHash, createHmac } from 'node:crypto';

export interface S3Settings {
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

const ALGORITHM = 'AWS4-HMAC-SHA256';
const SERVICE = 's3';

function sha256Hex(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodeKey(key: string): string {
  return key.split('/').map(encodeSegment).join('/');
}

function stamps(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

export interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

/**
 * Signs an S3 request with Signature Version 4, the only authentication the object store needs.
 */
export function signRequest(
  settings: S3Settings,
  method: string,
  path: string,
  body: Buffer,
  extraHeaders: Record<string, string> = {},
  now = new Date(),
): SignedRequest {
  const base = new URL(settings.endpoint);
  const canonicalUri = path;
  const url = `${base.origin}${canonicalUri}`;
  const { amzDate, dateStamp } = stamps(now);
  const payloadHash = sha256Hex(body);

  const headers: Record<string, string> = {
    host: base.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...Object.fromEntries(Object.entries(extraHeaders).map(([name, value]) => [name.toLowerCase(), value])),
  };

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]?.trim()}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    method,
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${settings.region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${settings.secretAccessKey}`, dateStamp), settings.region), SERVICE),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  return {
    url,
    headers: {
      ...headers,
      authorization: `${ALGORITHM} Credential=${settings.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

export function objectPath(settings: S3Settings, key: string): string {
  return settings.forcePathStyle
    ? `/${encodeSegment(settings.bucket)}/${encodeKey(key)}`
    : `/${encodeKey(key)}`;
}

export function bucketPath(settings: S3Settings): string {
  return settings.forcePathStyle ? `/${encodeSegment(settings.bucket)}` : '/';
}
