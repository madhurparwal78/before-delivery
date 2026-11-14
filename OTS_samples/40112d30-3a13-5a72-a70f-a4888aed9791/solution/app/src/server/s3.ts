import { createHash, createHmac } from 'node:crypto';
import { config } from './config.ts';

// MinIO stores file answers and CSV exports (brief: Services). AWS Signature V4 over fetch, nothing else.

const TIMEOUT_MS = 5_000;
const { endpoint, region, bucket, accessKeyId, secretAccessKey } = config.s3;

const sha256 = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: Uint8Array | string, data: string): Buffer => createHmac('sha256', key).update(data).digest();

const encodeSegment = (segment: string): string =>
  encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

async function signed(method: string, objectKey: string | null, body: Uint8Array | null, contentType?: string): Promise<Response> {
  const url = new URL(endpoint);
  const path = `/${[bucket, ...(objectKey ? objectKey.split('/') : [])].map(encodeSegment).join('/')}`;
  const stamp = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
  const day = stamp.slice(0, 8);
  const payloadHash = sha256(body ?? '');
  const headers: Record<string, string> = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': stamp };
  if (contentType) headers['content-type'] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [
    method, path, '', ...names.map((n) => `${n}:${headers[n]}`), '', names.join(';'), payloadHash,
  ].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  headers['authorization'] = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
  return fetch(`${endpoint}${path}`, {
    method,
    headers,
    body: body ? Buffer.from(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/** Store an object; resolves only once MinIO confirmed it, throws otherwise. */
export async function putObject(objectKey: string, body: Uint8Array, contentType: string): Promise<void> {
  const reply = await signed('PUT', objectKey, body, contentType);
  if (!reply.ok) throw new Error(`MinIO PUT ${reply.status}`);
}

export async function getObject(objectKey: string): Promise<{ body: Buffer; type: string }> {
  const reply = await signed('GET', objectKey, null);
  if (!reply.ok) throw new Error(`MinIO GET ${reply.status}`);
  return { body: Buffer.from(await reply.arrayBuffer()), type: reply.headers.get('content-type') ?? 'application/octet-stream' };
}

export async function deleteObject(objectKey: string): Promise<void> {
  const reply = await signed('DELETE', objectKey, null);
  if (!reply.ok && reply.status !== 404) throw new Error(`MinIO DELETE ${reply.status}`);
}

export async function checkMinio(): Promise<boolean> {
  try {
    return (await signed('HEAD', null, null)).ok;
  } catch {
    return false;
  }
}
