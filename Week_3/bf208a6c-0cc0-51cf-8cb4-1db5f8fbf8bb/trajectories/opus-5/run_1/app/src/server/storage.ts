import { createHash, createHmac } from 'node:crypto';
import { env } from './env';

const sha256Hex = (payload: Buffer | string): string => createHash('sha256').update(payload).digest('hex');
const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data).digest();

const encodeSegment = (segment: string): string =>
  encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

const encodePath = (path: string): string => path.split('/').map(encodeSegment).join('/');

interface SignedRequest {
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD';
  path: string;
  query?: Record<string, string>;
  body?: Buffer;
  contentType?: string;
}

const sendSigned = async (request: SignedRequest): Promise<Response> => {
  const endpoint = new URL(env.s3.endpoint);
  const body = request.body ?? Buffer.alloc(0);
  const payloadHash = sha256Hex(body);
  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const canonicalUri = encodePath(request.path);
  const canonicalQuery = Object.entries(request.query ?? {})
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => `${encodeSegment(key)}=${encodeSegment(value)}`)
    .join('&');

  const headers: Record<string, string> = {
    host: endpoint.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (request.contentType !== undefined) headers['content-type'] = request.contentType;

  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((name) => `${name}:${headers[name].trim()}\n`)
    .join('');
  const canonicalRequest = [
    request.method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${env.s3.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${env.s3.secretAccessKey}`, dateStamp), env.s3.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  const url = `${endpoint.origin}${canonicalUri}${canonicalQuery === '' ? '' : `?${canonicalQuery}`}`;
  return fetch(url, {
    method: request.method,
    headers: {
      ...headers,
      Authorization: `AWS4-HMAC-SHA256 Credential=${env.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body: request.method === 'PUT' ? body : undefined,
    signal: AbortSignal.timeout(10000),
  });
};

const bucketPath = (key?: string): string => (key === undefined ? `/${env.s3.bucket}` : `/${env.s3.bucket}/${key}`);

export const putObject = async (key: string, bytes: Buffer, contentType: string): Promise<void> => {
  const response = await sendSigned({ method: 'PUT', path: bucketPath(key), body: bytes, contentType });
  if (!response.ok) throw new Error(`storage put failed with ${response.status}`);
  await response.arrayBuffer();
};

export const getObject = async (key: string): Promise<Buffer> => {
  const response = await sendSigned({ method: 'GET', path: bucketPath(key) });
  if (!response.ok) throw new Error(`storage get failed with ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
};

const listObjects = async (prefix: string): Promise<string[]> => {
  const response = await sendSigned({ method: 'GET', path: bucketPath(), query: { 'list-type': '2', prefix } });
  if (!response.ok) throw new Error(`storage list failed with ${response.status}`);
  const xml = await response.text();
  return [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((match) => match[1]);
};

export const deletePrefix = async (prefix: string): Promise<void> => {
  for (const key of await listObjects(prefix)) {
    const response = await sendSigned({ method: 'DELETE', path: bucketPath(key) });
    if (!response.ok && response.status !== 404) throw new Error(`storage delete failed with ${response.status}`);
    await response.arrayBuffer();
  }
};

export const ensureBucket = async (): Promise<void> => {
  const head = await sendSigned({ method: 'HEAD', path: bucketPath() });
  if (head.ok) return;
  const created = await sendSigned({ method: 'PUT', path: bucketPath() });
  if (!created.ok) throw new Error(`storage bucket unavailable with ${created.status}`);
  await created.arrayBuffer();
};

export const checkStorage = async (): Promise<boolean> => {
  try {
    const response = await sendSigned({ method: 'HEAD', path: bucketPath() });
    await response.arrayBuffer();
    return response.ok;
  } catch {
    return false;
  }
};

export const attachmentKey = (boardId: string, postId: string, attachmentId: string): string =>
  `boards/${boardId}/posts/${postId}/${attachmentId}`;

export const boardPrefix = (boardId: string): string => `boards/${boardId}/`;

export const postPrefix = (boardId: string, postId: string): string => `boards/${boardId}/posts/${postId}/`;
