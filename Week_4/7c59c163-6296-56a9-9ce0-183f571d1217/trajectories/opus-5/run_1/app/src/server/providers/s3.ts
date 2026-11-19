import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';
import { ProviderRefused, providerFetch } from './http.js';

const PROVIDER = 'minio';
const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';
const UNSIGNED = 'UNSIGNED-PAYLOAD';

const endpoint = new URL(config.s3.endpoint);

function objectUrl(key: string): URL {
  const encoded = key.split('/').map(encodeURIComponent).join('/');
  const url = new URL(config.s3.endpoint);
  url.pathname = config.s3.forcePathStyle ? `/${config.s3.bucket}/${encoded}` : `/${encoded}`;
  if (!config.s3.forcePathStyle) url.host = `${config.s3.bucket}.${endpoint.host}`;
  return url;
}

function stamps(): { amzDate: string; dateStamp: string } {
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

function signingKey(dateStamp: string): Buffer {
  const date = createHmac('sha256', `AWS4${config.s3.secretAccessKey}`).update(dateStamp).digest();
  const region = createHmac('sha256', date).update(config.s3.region).digest();
  const service = createHmac('sha256', region).update(SERVICE).digest();
  return createHmac('sha256', service).update('aws4_request').digest();
}

function sign(
  method: string,
  url: URL,
  query: string,
  signedHeaders: Record<string, string>,
  payloadHash: string,
  amzDate: string,
  dateStamp: string,
): string {
  const names = Object.keys(signedHeaders).sort();
  const canonicalHeaders = names.map((name) => `${name}:${signedHeaders[name]}\n`).join('');
  const canonicalRequest = [
    method,
    url.pathname,
    query,
    canonicalHeaders,
    names.join(';'),
    payloadHash,
  ].join('\n');
  const scope = `${dateStamp}/${config.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = [
    ALGORITHM,
    amzDate,
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');
  return createHmac('sha256', signingKey(dateStamp)).update(stringToSign).digest('hex');
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const url = objectUrl(key);
  const { amzDate, dateStamp } = stamps();
  const payloadHash = createHash('sha256').update(body).digest('hex');
  const headers: Record<string, string> = {
    host: url.host,
    'content-type': contentType,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const signature = sign('PUT', url, '', headers, payloadHash, amzDate, dateStamp);
  const scope = `${dateStamp}/${config.s3.region}/${SERVICE}/aws4_request`;
  const response = await providerFetch(PROVIDER, url.toString(), {
    method: 'PUT',
    headers: {
      ...headers,
      authorization: `${ALGORITHM} Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${Object.keys(headers).sort().join(';')}, Signature=${signature}`,
    },
    body,
  });
  if (response.status >= 400) throw new ProviderRefused(PROVIDER, response.status, response.text);
}

export const LINK_TTL_SECONDS = 60;

/** A presigned GET URL on S3_ENDPOINT, valid for 60 seconds. */
export function presignGet(key: string): { url: string; expiresAt: Date } {
  const url = objectUrl(key);
  const { amzDate, dateStamp } = stamps();
  const scope = `${dateStamp}/${config.s3.region}/${SERVICE}/aws4_request`;
  const headers: Record<string, string> = { host: url.host };
  const parameters = new URLSearchParams({
    'X-Amz-Algorithm': ALGORITHM,
    'X-Amz-Credential': `${config.s3.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(LINK_TTL_SECONDS),
    'X-Amz-SignedHeaders': 'host',
  });
  parameters.sort();
  const query = parameters.toString();
  const signature = sign('GET', url, query, headers, UNSIGNED, amzDate, dateStamp);
  url.search = `${query}&X-Amz-Signature=${signature}`;
  return { url: url.toString(), expiresAt: new Date(Date.now() + LINK_TTL_SECONDS * 1000) };
}

export async function up(): Promise<boolean> {
  try {
    const response = await providerFetch(PROVIDER, `${config.s3.endpoint}/minio/health/live`, {
      timeoutMs: 2000,
    });
    return response.status < 500;
  } catch {
    return false;
  }
}
