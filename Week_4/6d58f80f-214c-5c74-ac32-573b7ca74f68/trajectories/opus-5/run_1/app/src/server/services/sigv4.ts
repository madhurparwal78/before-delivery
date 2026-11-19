import { createHash, createHmac } from 'node:crypto';

const sha256Hex = (data: Buffer | string): string =>
  createHash('sha256').update(data).digest('hex');

const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac('sha256', key).update(data, 'utf8').digest();

const encodeSegment = (segment: string): string =>
  encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export const encodeKeyPath = (key: string): string =>
  key.split('/').map(encodeSegment).join('/');

export interface SignedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Buffer;
}

export interface SigningCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
}

/** Signs a request for the S3 REST API with AWS Signature Version 4. */
export const signRequest = (
  request: SignedRequest,
  credentials: SigningCredentials,
  at: Date,
): Record<string, string> => {
  const url = new URL(request.url);
  const amzDate = `${at.toISOString().replace(/[-:]|\.\d{3}/g, '')}`;
  const stamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(request.body ?? '');

  const headers: Record<string, string> = {
    ...request.headers,
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };

  const canonicalHeaderNames = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const lowered = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim()]));
  const canonicalHeaders = canonicalHeaderNames
    .map((name) => `${name}:${lowered.get(name) ?? ''}\n`)
    .join('');
  const signedHeaders = canonicalHeaderNames.join(';');

  const query = [...url.searchParams.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeSegment(k)}=${encodeSegment(v)}`)
    .join('&');

  const canonicalRequest = [
    request.method,
    url.pathname,
    query,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${stamp}/${credentials.region}/${credentials.service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const dateKey = hmac(`AWS4${credentials.secretAccessKey}`, stamp);
  const regionKey = hmac(dateKey, credentials.region);
  const serviceKey = hmac(regionKey, credentials.service);
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
};
