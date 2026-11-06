import * as crypto from 'node:crypto';

export interface SigV4Credential {
  accessKeyId: string;
  date: string;
  region: string;
  service: string;
  scope: string;
}

export interface ParsedAuthorization {
  credential: SigV4Credential;
  signedHeaders: string[];
  signature: string;
}

export function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function hmac(key: Buffer, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

export function sha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export const emptyBodySha256 = sha256Hex('');

export function signingKey(secret: string, date: string, region: string, service: string): Buffer {
  const dateKey = hmac(Buffer.from(`AWS4${secret}`, 'utf8'), date);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, service);
  return hmac(serviceKey, 'aws4_request');
}

export function parseAuthorization(header: string | undefined): ParsedAuthorization | null {
  if (!header || !header.startsWith('AWS4-HMAC-SHA256 ')) return null;
  const parts = header.slice('AWS4-HMAC-SHA256 '.length).split(/,\s*/);
  const fields = new Map<string, string>();
  for (const part of parts) {
    const index = part.indexOf('=');
    if (index > 0) fields.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  const credential = fields.get('Credential');
  const signedHeaders = fields.get('SignedHeaders');
  const signature = fields.get('Signature');
  if (!credential || !signedHeaders || !signature) return null;
  const segments = credential.split('/');
  if (segments.length !== 5) return null;
  const [accessKeyId, date, region, service] = segments;
  return {
    credential: { accessKeyId, date, region, service, scope: `${date}/${region}/${service}/aws4_request` },
    signedHeaders: signedHeaders.split(';'),
    signature,
  };
}

export function canonicalQueryString(rawQuery: string): string {
  if (rawQuery === '') return '';
  const pairs = rawQuery.split('&').filter((pair) => pair !== '');
  const encoded = pairs.map((pair) => {
    const index = pair.indexOf('=');
    const name = index < 0 ? pair : pair.slice(0, index);
    const value = index < 0 ? '' : pair.slice(index + 1);
    return [rfc3986(decodeURIComponent(name)), rfc3986(decodeURIComponent(value.replace(/\+/g, '%20')))] as const;
  });
  encoded.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  return encoded.map(([name, value]) => `${name}=${value}`).join('&');
}

export function canonicalRequest(
  method: string,
  canonicalUri: string,
  rawQuery: string,
  headers: Record<string, string | string[] | undefined>,
  signedHeaders: string[],
  payloadHash: string,
): string {
  const canonicalHeaders = signedHeaders
    .map((name) => {
      const raw = headers[name];
      const value = Array.isArray(raw) ? raw.join(',') : (raw ?? '');
      return `${name}:${value.trim().replace(/\s+/g, ' ')}\n`;
    })
    .join('');
  return [method, canonicalUri, canonicalQueryString(rawQuery), canonicalHeaders, signedHeaders.join(';'), payloadHash].join('\n');
}

export function stringToSign(amzDate: string, scope: string, canonical: string): string {
  return ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonical)].join('\n');
}

export function computeSignature(secret: string, parsed: ParsedAuthorization, amzDate: string, canonical: string): string {
  const key = signingKey(secret, parsed.credential.date, parsed.credential.region, parsed.credential.service);
  return crypto.createHmac('sha256', key).update(stringToSign(amzDate, parsed.credential.scope, canonical), 'utf8').digest('hex');
}

export function chunkSignature(
  secret: string,
  credential: SigV4Credential,
  amzDate: string,
  previousSignature: string,
  chunkBytes: Buffer,
): string {
  const key = signingKey(secret, credential.date, credential.region, credential.service);
  const payload = [
    'AWS4-HMAC-SHA256-PAYLOAD',
    amzDate,
    credential.scope,
    previousSignature,
    emptyBodySha256,
    sha256Hex(chunkBytes),
  ].join('\n');
  return crypto.createHmac('sha256', key).update(payload, 'utf8').digest('hex');
}

export function constantTimeEquals(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export interface OutboundSignature {
  headers: Record<string, string>;
}

/** Signs an outbound request to MinIO with the configured service credentials. */
export function signOutbound(options: {
  method: string;
  url: URL;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  payloadHash: string;
  headers: Record<string, string>;
}): OutboundSignature {
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const date = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    ...options.headers,
    host: options.url.host,
    'x-amz-content-sha256': options.payloadHash,
    'x-amz-date': amzDate,
  };
  const signedHeaders = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalUri = options.url.pathname
    .split('/')
    .map((segment) => rfc3986(decodeURIComponent(segment)))
    .join('/');
  const canonical = canonicalRequest(
    options.method,
    canonicalUri,
    options.url.search.replace(/^\?/, ''),
    Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value])),
    signedHeaders,
    options.payloadHash,
  );
  const scope = `${date}/${options.region}/s3/aws4_request`;
  const key = signingKey(options.secretAccessKey, date, options.region, 's3');
  const signature = crypto
    .createHmac('sha256', key)
    .update(stringToSign(amzDate, scope, canonical), 'utf8')
    .digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${options.accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`;
  return { headers };
}
