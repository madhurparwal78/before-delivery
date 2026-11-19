import { createHash, createHmac } from 'node:crypto';
import { config } from './config';
import { apiError } from './errors';

const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');
const REQUEST_TIMEOUT_MS = 5000;

const awsEncode = (value: string): string =>
  encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

const encodeKey = (key: string): string => key.split('/').map(awsEncode).join('/');

const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac('sha256', key).update(data, 'utf8').digest();

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

const sign = (
  method: string,
  path: string,
  queryPairs: [string, string][],
  payloadSha256: string,
  extraHeaders: Record<string, string>,
): SignedRequest => {
  const endpoint = new URL(config.s3.endpoint);
  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);

  const canonicalQuery = queryPairs
    .map(([k, v]) => [awsEncode(k), awsEncode(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  const headers: Record<string, string> = {
    host: endpoint.host,
    'x-amz-content-sha256': payloadSha256,
    'x-amz-date': amzDate,
  };
  for (const [name, value] of Object.entries(extraHeaders)) headers[name.toLowerCase()] = value;

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]!.trim()}\n`).join('');
  const signedHeaders = names.join(';');

  const canonicalRequest = [
    method,
    path,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadSha256,
  ].join('\n');

  const scope = `${dateStamp}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    createHash('sha256').update(canonicalRequest, 'utf8').digest('hex'),
  ].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, dateStamp), config.s3.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  headers['authorization'] =
    `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const search = canonicalQuery ? `?${canonicalQuery}` : '';
  return { url: `${endpoint.origin}${path}${search}`, headers };
};

const objectPath = (key: string): string =>
  config.s3.forcePathStyle
    ? `/${awsEncode(config.s3.bucket)}/${encodeKey(key)}`
    : `/${encodeKey(key)}`;

const bucketPath = (): string => (config.s3.forcePathStyle ? `/${awsEncode(config.s3.bucket)}` : '/');

const unavailable = () => apiError('storage_unavailable');

const send = async (
  method: string,
  path: string,
  queryPairs: [string, string][],
  body: Buffer | null,
  extraHeaders: Record<string, string> = {},
): Promise<Response> => {
  const payloadSha256 = body ? createHash('sha256').update(body).digest('hex') : EMPTY_SHA256;
  const headers = { ...extraHeaders };
  if (body) headers['content-length'] = String(body.byteLength);
  const signed = sign(method, path, queryPairs, payloadSha256, headers);
  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: body ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw unavailable();
  }
};

export const putObject = async (key: string, body: Buffer, contentType: string): Promise<void> => {
  const response = await send('PUT', objectPath(key), [], body, { 'content-type': contentType });
  if (!response.ok) {
    await response.arrayBuffer();
    throw unavailable();
  }
  await response.arrayBuffer();
};

/** Reads an object, or null when storage answers that the key is absent. */
export const getObject = async (key: string): Promise<Buffer | null> => {
  const response = await send('GET', objectPath(key), [], null);
  if (response.status === 404) {
    await response.arrayBuffer();
    return null;
  }
  if (!response.ok) {
    await response.arrayBuffer();
    throw unavailable();
  }
  return Buffer.from(await response.arrayBuffer());
};

export const objectExists = async (key: string): Promise<boolean> => {
  const response = await send('HEAD', objectPath(key), [], null);
  if (response.status === 404) return false;
  if (!response.ok) throw unavailable();
  return true;
};

export const deleteObject = async (key: string): Promise<void> => {
  const response = await send('DELETE', objectPath(key), [], null);
  if (!response.ok && response.status !== 404) {
    await response.arrayBuffer();
    throw unavailable();
  }
  await response.arrayBuffer();
};

export const listKeys = async (prefix: string): Promise<string[]> => {
  const keys: string[] = [];
  let token: string | null = null;
  do {
    const pairs: [string, string][] = [
      ['list-type', '2'],
      ['prefix', prefix],
    ];
    if (token) pairs.push(['continuation-token', token]);
    const response = await send('GET', bucketPath(), pairs, null);
    if (!response.ok) {
      await response.arrayBuffer();
      throw unavailable();
    }
    const xml = await response.text();
    for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) {
      keys.push(decodeXmlText(match[1] ?? ''));
    }
    const next = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml);
    token = next ? decodeXmlText(next[1] ?? '') : null;
  } while (token);
  return keys;
};

const decodeXmlText = (value: string): string =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

export const deletePrefix = async (prefix: string): Promise<void> => {
  const keys = await listKeys(prefix);
  for (const key of keys) await deleteObject(key);
};

export const ensureBucket = async (): Promise<void> => {
  const response = await send('HEAD', bucketPath(), [], null);
  if (response.status === 404) {
    const created = await send('PUT', bucketPath(), [], Buffer.alloc(0));
    if (!created.ok && created.status !== 409) {
      await created.arrayBuffer();
      throw unavailable();
    }
    await created.arrayBuffer();
  } else if (!response.ok) {
    throw unavailable();
  }
};

export const storageHealthy = async (): Promise<boolean> => {
  try {
    const response = await send('HEAD', bucketPath(), [], null);
    return response.ok;
  } catch {
    return false;
  }
};
