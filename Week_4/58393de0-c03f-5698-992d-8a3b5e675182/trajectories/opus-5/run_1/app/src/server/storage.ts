import { createHash, createHmac } from 'node:crypto';
import { config } from './config.js';
import { storageUnavailable } from './errors.js';

const sha256Hex = (body: Buffer | string): string => createHash('sha256').update(body).digest('hex');

const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data).digest();

const amzDate = (now: Date): { stamp: string; day: string } => {
  const stamp = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  return { stamp, day: stamp.slice(0, 8) };
};

const encodeKey = (key: string): string =>
  key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

const sign = (method: string, path: string, payload: Buffer, query: string): SignedRequest => {
  const endpoint = new URL(config.s3.endpoint);
  const host = endpoint.host;
  const { stamp, day } = amzDate(new Date());
  const payloadHash = sha256Hex(payload);
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${stamp}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [method, path, query, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, day), config.s3.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  return {
    url: `${endpoint.origin}${path}${query ? `?${query}` : ''}`,
    headers: {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': stamp,
      authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
};

const pathFor = (key: string): string => {
  const encoded = key === '' ? '' : `/${encodeKey(key)}`;
  if (config.s3.forcePathStyle) return `/${config.s3.bucket}${encoded}`;
  return encoded === '' ? '/' : encoded;
};

const call = async (
  method: string,
  key: string,
  options: { payload?: Buffer; query?: string; contentType?: string; timeoutMs?: number } = {},
): Promise<Response> => {
  const payload = options.payload ?? Buffer.alloc(0);
  const signed = sign(method, pathFor(key), payload, options.query ?? '');
  const headers: Record<string, string> = { ...signed.headers };
  delete headers.host;
  if (options.contentType) headers['content-type'] = options.contentType;
  try {
    return await fetch(signed.url, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' || method === 'DELETE' ? undefined : new Uint8Array(payload),
      signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
    });
  } catch {
    throw storageUnavailable();
  }
};

export const putObject = async (key: string, body: Buffer, contentType: string): Promise<void> => {
  const response = await call('PUT', key, { payload: body, contentType });
  if (!response.ok) throw storageUnavailable();
  await response.arrayBuffer();
};

export const getObject = async (key: string): Promise<Buffer | null> => {
  const response = await call('GET', key);
  if (response.status === 404) {
    await response.arrayBuffer();
    return null;
  }
  if (!response.ok) throw storageUnavailable();
  return Buffer.from(await response.arrayBuffer());
};

export const deleteObject = async (key: string): Promise<void> => {
  const response = await call('DELETE', key);
  if (!response.ok && response.status !== 404) throw storageUnavailable();
  await response.arrayBuffer();
};

export const listObjectKeys = async (prefix: string): Promise<string[]> => {
  const keys: string[] = [];
  let token: string | null = null;
  do {
    const query = new URLSearchParams({ 'list-type': '2', prefix });
    if (token) query.set('continuation-token', token);
    const sorted = [...query.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
    const canonicalQuery = sorted
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const response = await call('GET', '', { query: canonicalQuery });
    if (!response.ok) throw storageUnavailable();
    const xml = await response.text();
    for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) keys.push(decodeXml(match[1]));
    const next = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml);
    token = next ? decodeXml(next[1]) : null;
  } while (token);
  return keys;
};

export const storageAnswers = async (): Promise<boolean> => {
  try {
    const response = await call('HEAD', '', { timeoutMs: 2000 });
    await response.arrayBuffer().catch(() => undefined);
    return response.ok || response.status === 403 || response.status === 301;
  } catch {
    return false;
  }
};

export const ensureBucket = async (): Promise<void> => {
  const head = await call('HEAD', '', { timeoutMs: 2000 });
  await head.arrayBuffer().catch(() => undefined);
  if (head.status === 404) {
    const made = await call('PUT', '', { timeoutMs: 5000 });
    await made.arrayBuffer().catch(() => undefined);
  }
};

const decodeXml = (value: string): string =>
  value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");

export const snapshotKey = (projectId: string, revision: number): string =>
  `projects/${projectId}/rev-${revision}.json`;

export const exportKey = (ownerId: string, exportId: string, fileName: string): string =>
  `exports/${ownerId}/${exportId}/${fileName}`;
