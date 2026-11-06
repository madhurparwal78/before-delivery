import { createHash, createHmac } from 'node:crypto';

export const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

export interface SigningKeys {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
}

export function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

export function encodeRfc3986(value: string, keepSlash = false): string {
  let encoded = encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  if (keepSlash) encoded = encoded.replace(/%2F/g, '/');
  return encoded;
}

export function amzDate(at: Date): { stamp: string; date: string } {
  const stamp = `${at.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  return { stamp, date: stamp.slice(0, 8) };
}

export function canonicalQuery(params: Array<[string, string]>): string {
  return params
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)] as [string, string])
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : left[1] < right[1] ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

export interface CanonicalRequest {
  method: string;
  path: string;
  query: string;
  headers: Array<[string, string]>;
  payloadHash: string;
}

function canonicalHeaders(headers: Array<[string, string]>): { canonical: string; signed: string } {
  const normalised = headers
    .map(([key, value]) => [key.toLowerCase(), value.trim().replace(/\s+/g, ' ')] as [string, string])
    .sort((left, right) => (left[0] < right[0] ? -1 : 1));
  return {
    canonical: `${normalised.map(([key, value]) => `${key}:${value}`).join('\n')}\n`,
    signed: normalised.map(([key]) => key).join(';'),
  };
}

export function signature(
  keys: SigningKeys,
  at: Date,
  request: CanonicalRequest,
): { signature: string; signedHeaders: string; credentialScope: string; stamp: string } {
  const { stamp, date } = amzDate(at);
  const { canonical, signed } = canonicalHeaders(request.headers);
  const canonicalRequest = [
    request.method,
    request.path,
    request.query,
    canonical,
    signed,
    request.payloadHash,
  ].join('\n');
  const credentialScope = `${date}/${keys.region}/${keys.service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    stamp,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const dateKey = hmac(`AWS4${keys.secretAccessKey}`, date);
  const regionKey = hmac(dateKey, keys.region);
  const serviceKey = hmac(regionKey, keys.service);
  const signingKey = hmac(serviceKey, 'aws4_request');
  return {
    signature: createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex'),
    signedHeaders: signed,
    credentialScope,
    stamp,
  };
}
