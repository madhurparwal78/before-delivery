import { createHash, createHmac } from 'node:crypto';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { env } from '../env.js';

const SERVICE = 's3';
const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

export class StorageUnavailable extends Error {
  constructor(cause?: unknown) {
    super('Object storage is unreachable');
    this.name = 'StorageUnavailable';
    this.cause = cause;
  }
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function amzDate(now: Date): { stamp: string; dateOnly: string } {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { stamp, dateOnly: stamp.slice(0, 8) };
}

interface SignedRequest {
  url: URL;
  headers: Record<string, string>;
}

function signRequest(
  method: string,
  pathname: string,
  searchParams: URLSearchParams,
  payloadSha: string,
  extraHeaders: Record<string, string>,
): SignedRequest {
  const endpoint = new URL(env.s3Endpoint);
  const url = new URL(endpoint.toString());
  url.pathname = pathname;
  url.search = searchParams.toString();

  const { stamp, dateOnly } = amzDate(new Date());
  const headers: Record<string, string> = { host: url.host };
  for (const [name, value] of Object.entries(extraHeaders)) {
    headers[name.toLowerCase()] = value;
  }
  headers['x-amz-content-sha256'] = payloadSha;
  headers['x-amz-date'] = stamp;

  const sortedNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedNames
    .map((name) => `${name}:${(headers[name] ?? '').trim()}\n`)
    .join('');
  const signedHeaders = sortedNames.join(';');

  const canonicalQuery = [...searchParams.entries()]
    .map(([key, value]) => [encodeSegment(key), encodeSegment(value)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  const canonicalRequest = [
    method,
    pathname,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadSha,
  ].join('\n');

  const scope = `${dateOnly}/${env.s3Region}/${SERVICE}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    stamp,
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const dateKey = hmac(`AWS4${env.s3SecretAccessKey}`, dateOnly);
  const regionKey = hmac(dateKey, env.s3Region);
  const serviceKey = hmac(regionKey, SERVICE);
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  headers['authorization'] =
    `AWS4-HMAC-SHA256 Credential=${env.s3AccessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url, headers };
}

function objectPath(key: string): string {
  const segments = key.split('/').map(encodeSegment).join('/');
  return env.s3ForcePathStyle ? `/${env.s3Bucket}/${segments}` : `/${segments}`;
}

function send(
  method: string,
  pathname: string,
  searchParams: URLSearchParams,
  payload: Buffer | null,
  extraHeaders: Record<string, string>,
): Promise<IncomingMessage> {
  const payloadSha = payload ? createHash('sha256').update(payload).digest('hex') : EMPTY_SHA256;
  const headers: Record<string, string> = { ...extraHeaders };
  if (payload) headers['content-length'] = String(payload.length);
  const signed = signRequest(method, pathname, searchParams, payloadSha, headers);
  const transport = signed.url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise<IncomingMessage>((resolve, reject) => {
    const req = transport(
      {
        protocol: signed.url.protocol,
        hostname: signed.url.hostname,
        port: signed.url.port,
        method,
        path: `${signed.url.pathname}${signed.url.search}`,
        headers: signed.headers,
      },
      resolve,
    );
    req.setTimeout(10_000, () => req.destroy(new Error('Object storage timed out')));
    req.on('error', reject);
    if (payload) req.end(payload);
    else req.end();
  });
}

async function drain(response: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of response) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

export async function ensureBucket(): Promise<void> {
  const pathname = env.s3ForcePathStyle ? `/${env.s3Bucket}/` : '/';
  const head = await send('HEAD', pathname, new URLSearchParams(), null, {});
  await drain(head);
  if (head.statusCode === 200) return;
  const created = await send('PUT', pathname, new URLSearchParams(), Buffer.alloc(0), {});
  await drain(created);
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  let response: IncomingMessage;
  try {
    response = await send('PUT', objectPath(key), new URLSearchParams(), body, {
      'content-type': contentType,
    });
  } catch (cause) {
    throw new StorageUnavailable(cause);
  }
  await drain(response);
  if ((response.statusCode ?? 500) >= 300) throw new StorageUnavailable();
}

export async function deleteObject(key: string): Promise<void> {
  try {
    const response = await send('DELETE', objectPath(key), new URLSearchParams(), null, {});
    await drain(response);
  } catch {
    // A left-over object is removed by the next successful delete attempt.
  }
}

export interface ObjectStream {
  stream: IncomingMessage;
  contentLength: number;
}

export async function getObjectStream(key: string): Promise<ObjectStream> {
  let response: IncomingMessage;
  try {
    response = await send('GET', objectPath(key), new URLSearchParams(), null, {});
  } catch (cause) {
    throw new StorageUnavailable(cause);
  }
  if ((response.statusCode ?? 500) >= 300) {
    response.resume();
    throw new StorageUnavailable();
  }
  return { stream: response, contentLength: Number(response.headers['content-length'] ?? 0) };
}
