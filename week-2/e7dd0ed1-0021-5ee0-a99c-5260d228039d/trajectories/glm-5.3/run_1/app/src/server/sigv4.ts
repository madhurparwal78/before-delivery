import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** SigV4 credential parsing and verification. */
export interface SigV4Parts {
  accessKeyId: string;
  credentialDate: string;
  region: string;
  service: string;
  signedHeaders: string[];
  signature: string;
}

export function parseAuthorization(header: string): SigV4Parts | null {
  const m = /^AWS4-HMAC-SHA256 Credential=([^,]+),\s*SignedHeaders=([^,]+),\s*Signature=([0-9a-f]{64})$/.exec(header.trim());
  if (!m) return null;
  // Credential = keyId/date/region/service/aws4_request
  const cred = m[1].split('/');
  if (cred.length !== 5 || cred[4] !== 'aws4_request') return null;
  return {
    accessKeyId: cred[0],
    credentialDate: cred[1],
    region: cred[2],
    service: cred[3],
    signedHeaders: m[2].split(';'),
    signature: m[3],
  };
}

export function signingKey(secret: string, date: string, region: string, service: string): Buffer {
  const kDate = createHmac('sha256', 'AWS4' + secret).update(date).digest();
  const kRegion = createHmac('sha256', kDate).update(region).digest();
  const kService = createHmac('sha256', kRegion).update(service).digest();
  return createHmac('sha256', kService).update('aws4_request').digest();
}

export function sha256HexOf(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

const EMPTY_SHA = sha256HexOf('');

/** Verifies a SigV4 header signature for a canonical request. */
export function verifySigV4(
  parts: SigV4Parts,
  secret: string,
  method: string,
  rawPath: string,
  query: URLSearchParams,
  headers: Record<string, string>,
  payloadSha: string,
): boolean {
  const canonical = canonicalRequest(method, rawPath, query, headers, parts.signedHeaders, payloadSha);
  const scope = `${parts.credentialDate}/${parts.region}/${parts.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', headers['x-amz-date'] ?? '', scope, sha256HexOf(canonical)].join('\n');
  const key = signingKey(secret, parts.credentialDate, parts.region, parts.service);
  const computed = createHmac('sha256', key).update(stringToSign).digest('hex');
  return timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(parts.signature, 'hex'));
}

/** The chunk signature: HMAC over six joined lines. */
export function chunkSignature(
  signing: Buffer, date: string, scope: string, previousSignature: string,
  chunkSha: string,
): string {
  const stringToSign = [
    'AWS4-HMAC-SHA256-PAYLOAD', date, scope, previousSignature, EMPTY_SHA, chunkSha,
  ].join('\n');
  return createHmac('sha256', signing).update(stringToSign).digest('hex');
}

function canonicalRequest(
  method: string, rawPath: string, query: URLSearchParams,
  headers: Record<string, string>, signedHeaders: string[], payloadSha: string,
): string {
  const canonicalPath = encodeCanonicalPath(rawPath);
  const names = [...query.keys()].sort();
  const params: string[] = [];
  for (const name of names) {
    for (const v of query.getAll(name)) {
      params.push(`${encodeRfc3986(name)}=${encodeRfc3986(v)}`);
    }
  }
  params.sort();
  const headerLines = signedHeaders
    .filter(h => h !== 'host' || true)
    .map(h => {
      const lower = h.toLowerCase();
      let value = headers[lower] ?? '';
      if (lower === 'host') value = headers['host'] ?? '';
      if (lower === 'content-length' && value === '') value = '';
      return `${lower}:${value.trim()}\n`;
    })
    .join('');
  return [method, canonicalPath, params.join('&'), headerLines, signedHeaders.join(';'), payloadSha].join('\n');
}

/** Canonical URI: each path segment is URI-encoded, but / stays. */
function encodeCanonicalPath(path: string): string {
  return path.split('/').map(encodeRfc3986).join('/');
}

/** Canonical query: names and values are URI-encoded. */
function encodeRfc3986(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

