import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';
import { AppError } from '../errors.js';

const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';
const REQUEST_TIMEOUT_MS = 20_000;

function sha256Hex(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalUri(key: string): string {
  const path = key.split('/').map(encodeSegment).join('/');
  return config.storage.forcePathStyle ? `/${config.storage.bucket}/${path}` : `/${path}`;
}

function endpointHost(): string {
  return new URL(config.storage.endpoint).host;
}

function stamps(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

function signingKey(dateStamp: string): Buffer {
  const dateKey = hmac(`AWS4${config.storage.secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, config.storage.region);
  const serviceKey = hmac(regionKey, SERVICE);
  return hmac(serviceKey, 'aws4_request');
}

function credentialScope(dateStamp: string): string {
  return `${dateStamp}/${config.storage.region}/${SERVICE}/aws4_request`;
}

function sign(canonicalRequest: string, amzDate: string, dateStamp: string): string {
  const stringToSign = [ALGORITHM, amzDate, credentialScope(dateStamp), sha256Hex(canonicalRequest)].join('\n');
  return createHmac('sha256', signingKey(dateStamp)).update(stringToSign, 'utf8').digest('hex');
}

async function send(method: string, key: string, body?: Buffer, contentType?: string): Promise<Response> {
  const { amzDate, dateStamp } = stamps(new Date());
  const payloadHash = sha256Hex(body ?? '');
  const host = endpointHost();
  const headerEntries: [string, string][] = [
    ['host', host],
    ['x-amz-content-sha256', payloadHash],
    ['x-amz-date', amzDate],
  ];
  if (contentType) headerEntries.push(['content-type', contentType]);
  headerEntries.sort(([a], [b]) => (a < b ? -1 : 1));
  const canonicalHeaders = `${headerEntries.map(([name, value]) => `${name}:${value}`).join('\n')}\n`;
  const signedHeaders = headerEntries.map(([name]) => name).join(';');
  const canonicalRequest = [method, canonicalUri(key), '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const signature = sign(canonicalRequest, amzDate, dateStamp);
  const headers: Record<string, string> = {
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    Authorization: `${ALGORITHM} Credential=${config.storage.accessKeyId}/${credentialScope(dateStamp)}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (contentType) headers['content-type'] = contentType;
  return fetch(`${config.storage.endpoint}${canonicalUri(key)}`, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  let response: Response;
  try {
    response = await send('PUT', key, body, contentType);
  } catch {
    throw new AppError('storage_unavailable');
  }
  if (!response.ok) throw new AppError('storage_unavailable');
}

/** Objects are served only through presigned GET links that expire after MEDIA_LINK_SECONDS. */
export function presignGet(key: string): string {
  const { amzDate, dateStamp } = stamps(new Date());
  const host = endpointHost();
  const parameters: [string, string][] = [
    ['X-Amz-Algorithm', ALGORITHM],
    ['X-Amz-Credential', `${config.storage.accessKeyId}/${credentialScope(dateStamp)}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(config.mediaLinkSeconds)],
    ['X-Amz-SignedHeaders', 'host'],
  ];
  parameters.sort(([a], [b]) => (a < b ? -1 : 1));
  const canonicalQuery = parameters
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join('&');
  const canonicalRequest = [
    'GET',
    canonicalUri(key),
    canonicalQuery,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const signature = sign(canonicalRequest, amzDate, dateStamp);
  return `${config.storage.endpoint}${canonicalUri(key)}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    const response = await send('HEAD', key);
    return response.ok;
  } catch {
    throw new AppError('storage_unavailable');
  }
}

export async function reachable(): Promise<boolean> {
  try {
    const response = await send('HEAD', '');
    return response.status < 500;
  } catch {
    return false;
  }
}
