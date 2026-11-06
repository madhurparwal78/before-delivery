import { createHash, createHmac } from 'node:crypto';
import { request } from 'node:http';
import { request as requestTls } from 'node:https';
import { config } from './config.js';

/**
 * A minimal S3 REST client with AWS Signature V4 signing, used for the single
 * object per proposal at documents/<documentId>.json.
 */
function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function signingKey(secret: string, date: string, region: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, 's3');
  return hmac(kService, 'aws4_request');
}

async function s3Request(method: 'GET' | 'PUT' | 'DELETE' | 'HEAD', key: string, body?: string): Promise<{ status: number; body: string }> {
  const url = new URL(config.s3.endpoint);
  const path = config.s3.forcePathStyle
    ? `/${config.s3.bucket}/${key}`
    : `/${key}`;
  const host = config.s3.forcePathStyle
    ? url.host
    : `${config.s3.bucket}.${url.host}`;
  const payload = body ?? '';
  const payloadHash = sha256(payload);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((k) => `${k}:${headers[k]!.trim()}\n`)
    .join('');
  const signedList = Object.keys(headers).sort().join(';');
  const canonicalRequest = [
    method,
    path,
    '',
    canonicalHeaders,
    signedList,
    payloadHash,
  ].join('\n');
  const scope = `${date}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const signature = createHmac('sha256', signingKey(config.s3.secretAccessKey, date, config.s3.region)).update(stringToSign).digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedList}, Signature=${signature}`;

  return new Promise((resolve, reject) => {
    const send = url.protocol === 'https:' ? requestTls : request;
    const req = send(
      {
        host: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        method,
        path,
        headers: { ...headers, Authorization: authorization, ...(body !== undefined ? { 'content-length': String(Buffer.byteLength(body)) } : {}) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') }));
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

export async function putObject(key: string, body: string): Promise<void> {
  const res = await s3Request('PUT', key, body);
  if (res.status !== 200) throw new Error(`s3 put failed: ${res.status}`);
}

export async function getObject(key: string): Promise<string | null> {
  const res = await s3Request('GET', key);
  if (res.status === 404) return null;
  if (res.status !== 200) throw new Error(`s3 get failed: ${res.status}`);
  return res.body;
}

export async function deleteObject(key: string): Promise<void> {
  const res = await s3Request('DELETE', key);
  if (res.status !== 204 && res.status !== 200 && res.status !== 404) throw new Error(`s3 delete failed: ${res.status}`);
}
