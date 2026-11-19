import { createHash, createHmac } from 'node:crypto';
import { config } from './config.js';

const s3Config = config.s3;

const hostOf = (): { host: string; port: number } => {
  const url = new URL(s3Config.endpoint);
  return { host: url.hostname, port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80) };
};

const sha256Hex = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');

const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data).digest();

const uriEncode = (s: string, encodeSlash = true): string =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  ).replace(/%2F/g, encodeSlash ? '%2F' : '/');

/** Minimal AWS SigV4 request against the provided MinIO instance. */
export const s3Request = async (
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD',
  key: string,
  body?: Buffer,
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> => {
  const { host, port } = hostOf();
  const bucket = s3Config.bucket;
  const hostHeader = s3Config.forcePathStyle
    ? host + (port === 80 || port === 443 ? '' : `:${port}`)
    : `${bucket}.${host}${port === 80 || port === 443 ? '' : `:${port}`}`;
  const path = s3Config.forcePathStyle ? `/${bucket}/${key}` : `/${key}`;
  const payloadHash = body ? sha256Hex(body) : sha256Hex('');
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);

  const canonicalHeaders = `host:${hostHeader}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    method, uriEncode(path, false), '', canonicalHeaders, signedHeaders, payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${s3Config.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest),
  ].join('\n');

  let signingKey: Buffer = hmac(`AWS4${s3Config.secretAccessKey}`, dateStamp);
  signingKey = hmac(signingKey, s3Config.region);
  signingKey = hmac(signingKey, 's3');
  signingKey = hmac(signingKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  const auth = `AWS4-HMAC-SHA256 Credential=${s3Config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const scheme = s3Config.endpoint.startsWith('https') ? 'https' : 'http';
  const url = s3Config.forcePathStyle
    ? `${scheme}://${hostHeader}/${bucket}/${uriEncode(key, false)}`
    : `${scheme}://${hostHeader}/${uriEncode(key, false)}`;

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: auth,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    },
    body: body ? new Uint8Array(body) : undefined,
    signal: AbortSignal.timeout(2000),
  });
  const buf = Buffer.from(await response.arrayBuffer());
  const headers: Record<string, string> = {};
  response.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  return { status: response.status, headers, body: buf };
};

export const putObject = async (key: string, body: Buffer): Promise<boolean> => {
  const res = await s3Request('PUT', key, body);
  if (res.status !== 200) return false;
  const head = await s3Request('HEAD', key);
  return head.status === 200 && Number(head.headers['content-length']) === body.length;
};

export const getObject = async (key: string): Promise<Buffer | null> => {
  const res = await s3Request('GET', key);
  if (res.status !== 200) return null;
  return res.body;
};

export const checkStorage = async (): Promise<boolean> => {
  try {
    const res = await s3Request('GET', '');
    return res.status === 200 || res.status === 404;
  } catch {
    return false;
  }
};
