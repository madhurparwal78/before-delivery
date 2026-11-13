import { createHash, createHmac } from 'node:crypto';

import { config } from './config';
import { storageUnavailable } from './errors';

const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

export const sha256Hex = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');

const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data).digest();

const encodeSegment = (segment: string): string =>
  encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

const sign = (method: string, objectPath: string, payloadHash: string, extra: Record<string, string>): SignedRequest => {
  const { endpoint, region, bucket, forcePathStyle, accessKeyId, secretAccessKey } = config.s3;
  const base = new URL(endpoint);
  const segments = objectPath === '' ? [] : objectPath.split('/');
  const encoded = segments.map(encodeSegment).join('/');
  const canonicalPath = forcePathStyle
    ? `/${encodeSegment(bucket)}${encoded === '' ? '' : `/${encoded}`}`
    : `/${encoded}`;
  const host = forcePathStyle ? base.host : `${bucket}.${base.host}`;
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...extra,
  };

  const headerNames = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = headerNames
    .map((name) => {
      const value = Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1] ?? '';
      return `${name}:${value.trim()}\n`;
    })
    .join('');
  const signedHeaders = headerNames.join(';');
  const canonicalRequest = [method, canonicalPath, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url: `${base.origin}${canonicalPath}`, headers };
};

const call = async (
  method: string,
  objectPath: string,
  body: Buffer | undefined,
  extra: Record<string, string> = {},
): Promise<Response> => {
  const payloadHash = body === undefined ? EMPTY_SHA256 : sha256Hex(body);
  const signed = sign(method, objectPath, payloadHash, extra);
  return fetch(signed.url, {
    method,
    headers: signed.headers,
    body: body as unknown as BodyInit | undefined,
    signal: AbortSignal.timeout(4000),
  });
};

/** Writes the bytes exactly as received. Throws storage_unavailable when MinIO does not confirm. */
export const putObject = async (key: string, body: Buffer, contentType: string): Promise<void> => {
  let response: Response;
  try {
    response = await call('PUT', key, body, { 'content-type': contentType, 'content-length': String(body.length) });
  } catch {
    throw storageUnavailable();
  }
  if (!response.ok) throw storageUnavailable();
  await response.arrayBuffer();
};

export const getObject = async (key: string): Promise<{ body: Buffer; contentType: string }> => {
  let response: Response;
  try {
    response = await call('GET', key, undefined);
  } catch {
    throw storageUnavailable();
  }
  if (!response.ok) throw storageUnavailable();
  const body = Buffer.from(await response.arrayBuffer());
  return { body, contentType: response.headers.get('content-type') ?? 'application/octet-stream' };
};

export const ensureBucket = async (): Promise<void> => {
  try {
    const head = await call('HEAD', '', undefined);
    if (head.status === 404) await call('PUT', '', Buffer.alloc(0));
  } catch {
    /* MinIO being down at boot never stops the server. */
  }
};

let lastProbe = { at: 0, reachable: false };

/** Reachability, measured at most 5 seconds before it is used. */
export const storageReachable = async (): Promise<boolean> => {
  if (Date.now() - lastProbe.at < 2000) return lastProbe.reachable;
  let reachable = false;
  try {
    const response = await call('HEAD', '', undefined);
    reachable = response.ok || response.status === 404;
    await response.arrayBuffer().catch(() => undefined);
  } catch {
    reachable = false;
  }
  lastProbe = { at: Date.now(), reachable };
  return reachable;
};
