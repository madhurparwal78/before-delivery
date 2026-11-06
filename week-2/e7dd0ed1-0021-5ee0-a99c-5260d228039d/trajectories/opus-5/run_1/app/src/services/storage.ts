import * as http from 'node:http';
import * as https from 'node:https';
import { Readable } from 'node:stream';
import { config } from '../config';
import { signOutbound, sha256Hex, rfc3986 } from '../crypto/sigv4';

export class StorageUnavailable extends Error {
  constructor(cause?: unknown) {
    super('storage unavailable');
    this.cause = cause;
  }
}

const endpoint = new URL(config.s3.endpoint);
const transport = endpoint.protocol === 'https:' ? https : http;

function objectUrl(key: string): URL {
  const encoded = key.split('/').map(rfc3986).join('/');
  return new URL(`${endpoint.origin}/${config.s3.bucket}/${encoded}`);
}

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  stream: http.IncomingMessage;
}

function send(options: {
  method: string;
  url: URL;
  payloadHash: string;
  headers?: Record<string, string>;
  body?: Buffer | Readable;
}): Promise<RawResponse> {
  const signed = signOutbound({
    method: options.method,
    url: options.url,
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
    region: config.s3.region,
    payloadHash: options.payloadHash,
    headers: options.headers ?? {},
  });
  return new Promise((resolve, reject) => {
    const request = transport.request(
      {
        protocol: options.url.protocol,
        hostname: options.url.hostname,
        port: options.url.port,
        method: options.method,
        path: `${options.url.pathname}${options.url.search}`,
        headers: signed.headers,
        timeout: 30000,
      },
      (response) => resolve({ status: response.statusCode ?? 0, headers: response.headers, stream: response }),
    );
    request.on('error', (error) => reject(new StorageUnavailable(error)));
    request.on('timeout', () => request.destroy(new StorageUnavailable(new Error('timeout'))));
    if (options.body instanceof Readable) options.body.pipe(request);
    else {
      if (options.body) request.write(options.body);
      request.end();
    }
  });
}

async function drain(stream: http.IncomingMessage): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of stream) parts.push(chunk as Buffer);
  return Buffer.concat(parts);
}

export async function ensureBucket(): Promise<void> {
  const url = new URL(`${endpoint.origin}/${config.s3.bucket}`);
  const head = await send({ method: 'HEAD', url, payloadHash: sha256Hex('') });
  await drain(head.stream);
  if (head.status === 200) return;
  const created = await send({ method: 'PUT', url, payloadHash: sha256Hex(''), headers: { 'content-length': '0' } });
  await drain(created.stream);
}

export async function putBytes(key: string, body: Buffer): Promise<void> {
  const response = await send({
    method: 'PUT',
    url: objectUrl(key),
    payloadHash: sha256Hex(body),
    headers: { 'content-length': String(body.length), 'content-type': 'application/octet-stream' },
    body,
  });
  const text = await drain(response.stream);
  if (response.status < 200 || response.status >= 300) throw new StorageUnavailable(new Error(`put ${response.status} ${text.toString('utf8').slice(0, 200)}`));
}

export async function putStream(key: string, source: AsyncIterable<Buffer>, length: number): Promise<void> {
  const response = await send({
    method: 'PUT',
    url: objectUrl(key),
    payloadHash: 'UNSIGNED-PAYLOAD',
    headers: { 'content-length': String(length), 'content-type': 'application/octet-stream' },
    body: Readable.from(source),
  });
  const text = await drain(response.stream);
  if (response.status < 200 || response.status >= 300) throw new StorageUnavailable(new Error(`put ${response.status} ${text.toString('utf8').slice(0, 200)}`));
}

export async function getBytes(key: string): Promise<Buffer | null> {
  const response = await send({ method: 'GET', url: objectUrl(key), payloadHash: sha256Hex('') });
  const body = await drain(response.stream);
  if (response.status === 404) return null;
  if (response.status !== 200) throw new StorageUnavailable(new Error(`get ${response.status}`));
  return body;
}

export async function deleteBytes(key: string): Promise<void> {
  const response = await send({ method: 'DELETE', url: objectUrl(key), payloadHash: sha256Hex('') });
  await drain(response.stream);
  if (response.status !== 204 && response.status !== 200 && response.status !== 404) {
    throw new StorageUnavailable(new Error(`delete ${response.status}`));
  }
}

export async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const url = new URL(`${endpoint.origin}/${config.s3.bucket}`);
    url.searchParams.set('list-type', '2');
    url.searchParams.set('prefix', prefix);
    if (token) url.searchParams.set('continuation-token', token);
    const response = await send({ method: 'GET', url, payloadHash: sha256Hex('') });
    const body = (await drain(response.stream)).toString('utf8');
    if (response.status !== 200) throw new StorageUnavailable(new Error(`list ${response.status}`));
    for (const match of body.matchAll(/<Key>([^<]*)<\/Key>/g)) {
      keys.push(match[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
    }
    const next = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(body);
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(body);
    token = truncated && next ? next[1] : undefined;
  } while (token);
  return keys;
}

export function regionObjectKey(region: string, bucket: string, versionId: string): string {
  return `regions/${region}/${bucket}/${versionId}`;
}

export function partObjectKey(uploadId: string, partNumber: number): string {
  return `uploads/${uploadId}/${partNumber}`;
}
