import { createHmac, createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { AppConfig } from './config.js';

/**
 * Minimal SigV4 PUT/GET/HEAD against one S3-compatible endpoint. Each call
 * opens a fresh connection, so storage recovers as soon as MinIO is back.
 */
export async function putObject(
  config: AppConfig, key: string, body: Buffer, contentType: string,
): Promise<boolean> {
  return withSignedRequest(config, 'PUT', key, body, contentType, (req) => {
    req.end(body);
  });
}

export async function headObject(config: AppConfig, key: string): Promise<boolean> {
  return withSignedRequest(config, 'HEAD', key, Buffer.alloc(0), undefined, (req) => {
    req.end();
  }, (res) => res.statusCode === 200);
}

export async function getObject(config: AppConfig, key: string): Promise<Buffer | null> {
  let resolve: (value: Buffer | null) => void = () => {};
  const promise = new Promise<Buffer | null>((r) => { resolve = r; });
  const url = objectUrl(config, key);
  const signed = sign('GET', config, key, '', '');
  const mod = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const req = mod(url, { method: 'GET', headers: signed.headers, timeout: 10000 }, (res) => {
    if (res.statusCode !== 200) {
      res.resume();
      resolve(null);
      return;
    }
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => resolve(Buffer.concat(chunks)));
    res.on('error', () => resolve(null));
  });
  req.on('error', () => resolve(null));
  req.on('timeout', () => { req.destroy(); resolve(null); });
  req.end();
  return promise;
}

export function exportKey(diagramId: string, exportId: string, format: 'png' | 'svg'): string {
  return `exports/${diagramId}/${exportId}.${format}`;
}

function objectUrl(config: AppConfig, key: string): URL {
  const base = config.s3.endpoint.replace(/\/$/, '');
  if (config.s3.forcePathStyle) {
    return new URL(`${base}/${config.s3.bucket}/${key}`);
  }
  const parsed = new URL(base);
  return new URL(`${parsed.protocol}//${config.s3.bucket}.${parsed.host}/${key}`);
}

function withSignedRequest(
  config: AppConfig,
  method: string,
  key: string,
  body: Buffer,
  contentType: string | undefined,
  write: (req: import('node:http').ClientRequest) => void,
  check?: (res: import('node:http').IncomingMessage) => boolean,
): Promise<boolean> {
  let resolve: (value: boolean) => void = () => {};
  const promise = new Promise<boolean>((r) => { resolve = r; });
  const url = objectUrl(config, key);
  const payloadHash = createHash('sha256').update(body).digest('hex');
  const signed = sign(method, config, key, contentType ?? '', payloadHash);
  const headers = { ...signed.headers };
  if (contentType) headers['content-type'] = contentType;
  const mod = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const req = mod(url, { method, headers, timeout: 10000 }, (res) => {
    res.resume();
    const ok = check ? check(res) : res.statusCode === 200;
    res.on('end', () => resolve(ok));
    res.on('error', () => resolve(false));
  });
  req.on('error', () => resolve(false));
  req.on('timeout', () => { req.destroy(); resolve(false); });
  write(req);
  return promise;
}

function sign(
  method: string,
  config: AppConfig,
  key: string,
  contentType: string,
  payloadHash: string,
): { headers: Record<string, string>; amzDate: string; dateStamp: string } {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const url = objectUrl(config, key);
  const canonicalUri = url.pathname;
  const canonicalQuery = url.search.replace(/^\?/, '');
  const payload = method === 'HEAD' || method === 'GET' ? 'UNSIGNED-PAYLOAD' : payloadHash;
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payload,
    'x-amz-date': amzDate,
  };
  if (contentType) headers['content-type'] = contentType;
  const sortedKeys = Object.keys(headers).sort();
  const canonicalHeaders = sortedKeys.map((h) => `${h}:${headers[h]}\n`).join('');
  const signedHeaders = sortedKeys.join(';');
  const canonicalRequest = [
    method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payload,
  ].join('\n');
  const scope = `${dateStamp}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');
  const kDate = createHmac('sha256', `AWS4${config.s3.secretAccessKey}`).update(dateStamp).digest();
  const kRegion = createHmac('sha256', kDate).update(config.s3.region).digest();
  const kService = createHmac('sha256', kRegion).update('s3').digest();
  const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  const auth = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { headers: { ...headers, authorization: auth }, amzDate, dateStamp };
}

export async function ensureBucket(config: AppConfig): Promise<boolean> {
  const url = objectUrl(config, '');
  const signed = sign('PUT', config, '', '', '');
  const mod = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise<boolean>((resolve) => {
    const req = mod(url, { method: 'PUT', headers: signed.headers, timeout: 10000 }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode === 200 || res.statusCode === 409));
      res.on('error', () => resolve(false));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}
