import { createHash, createHmac } from 'node:crypto';

const ALGORITHM = 'AWS4-HMAC-SHA256';

export interface SignedRequest {
  method: string;
  url: URL;
  headers: Record<string, string>;
  payload: Buffer;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  at: Date;
}

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function amzDate(at: Date): string {
  return `${at.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
}

function canonicalUri(pathname: string): string {
  return pathname
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

/** Adds the AWS Signature Version 4 headers for an S3 request. */
export function signS3Request(request: SignedRequest): Record<string, string> {
  const stamp = amzDate(request.at);
  const date = stamp.slice(0, 8);
  const payloadHash = sha256Hex(request.payload);

  const headers: Record<string, string> = {
    ...request.headers,
    host: request.url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
  };

  const names = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const lookup = new Map(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
  const canonicalHeaders = names
    .map((name) => `${name}:${(lookup.get(name) ?? '').trim().replace(/\s+/g, ' ')}\n`)
    .join('');
  const signedHeaders = names.join(';');

  const canonicalQuery = [...request.url.searchParams.entries()]
    .map(([key, value]): [string, string] => [encodeURIComponent(key), encodeURIComponent(value)])
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  const canonicalRequest = [
    request.method,
    canonicalUri(request.url.pathname),
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${date}/${request.region}/${request.service}/aws4_request`;
  const stringToSign = [ALGORITHM, stamp, scope, sha256Hex(canonicalRequest)].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${request.secretAccessKey}`, date), request.region), request.service),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  return {
    ...headers,
    Authorization: `${ALGORITHM} Credential=${request.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
