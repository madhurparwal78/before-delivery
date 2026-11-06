// MinIO over the S3 API: put, get, list and delete with AWS signature version 4.

import { createHash, createHmac } from 'node:crypto';
import { unavailable } from './http';
import { COPY } from '../shared/copy';
import { config } from './config';

const { endpoint, region, bucket, accessKeyId, secretAccessKey, forcePathStyle } = config.s3;

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function encode(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function signed(method: string, key: string, query: Record<string, string>, body: Buffer, contentType?: string): Promise<Response> {
  const base = new URL(endpoint);
  const host = forcePathStyle ? base.host : `${bucket}.${base.host}`;
  const path = forcePathStyle ? `/${encode(bucket)}${key ? `/${encode(key)}` : ''}` : `/${encode(key)}`;
  const amzDate = new Date().toISOString().replace(/[-:]|\.\d+/g, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const queryText = Object.keys(query)
    .sort()
    .map((name) => `${encodeURIComponent(name)}=${encodeURIComponent(query[name] as string)}`)
    .join('&');
  const headers: Record<string, string> = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const signedNames = Object.keys(headers).sort().join(';');
  const canonical = [
    method,
    path,
    queryText,
    Object.keys(headers).sort().map((name) => `${name}:${headers[name]}\n`).join(''),
    signedNames,
    payloadHash,
  ].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256Hex(canonical)}`;
  let signingKey: Buffer = Buffer.from(`AWS4${secretAccessKey}`);
  for (const part of [day, region, 's3', 'aws4_request']) signingKey = createHmac('sha256', signingKey).update(part).digest();
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  const requestHeaders: Record<string, string> = {
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedNames}, Signature=${signature}`,
  };
  if (contentType) requestHeaders['Content-Type'] = contentType;
  const address = `${base.protocol}//${host}${path}${queryText ? `?${queryText}` : ''}`;
  return fetch(address, {
    method,
    headers: requestHeaders,
    ...(body.length ? { body: new Uint8Array(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
}

/** The published outage answer for anything a broken file store stops. */
export function storeDown(): ReturnType<typeof unavailable> {
  return unavailable(COPY.storeDown);
}

export class StoreFailure extends Error {}

export async function ensureBucket(): Promise<void> {
  const head = await signed('HEAD', '', {}, Buffer.alloc(0));
  if (head.status === 404) await signed('PUT', '', {}, Buffer.alloc(0));
}

async function attempt(work: () => Promise<Response>, expected: number[]): Promise<Response> {
  let response: Response;
  try {
    response = await work();
  } catch {
    throw new StoreFailure('the file store did not answer');
  }
  if (!expected.includes(response.status)) throw new StoreFailure(`the file store answered ${response.status}`);
  return response;
}

export async function putObject(key: string, data: Buffer, contentType: string): Promise<void> {
  try {
    const response = await signed('PUT', key, {}, data, contentType);
    if (response.status === 404) {
      await ensureBucket();
      await attempt(() => signed('PUT', key, {}, data, contentType), [200]);
    } else if (response.status !== 200) {
      throw new StoreFailure(`the file store answered ${response.status}`);
    }
  } catch (error) {
    throw error instanceof StoreFailure ? error : new StoreFailure('the file store did not answer');
  }
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await attempt(() => signed('GET', key, {}, Buffer.alloc(0)), [200]);
  return Buffer.from(await response.arrayBuffer());
}

export async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const query: Record<string, string> = { 'list-type': '2', prefix };
    if (token) query['continuation-token'] = token;
    const response = await signed('GET', '', query, Buffer.alloc(0)).catch(() => {
      throw new StoreFailure('the file store did not answer');
    });
    if (response.status === 404) {
      await ensureBucket();
      return keys;
    }
    if (response.status !== 200) throw new StoreFailure(`the file store answered ${response.status}`);
    const text = await response.text();
    for (const match of text.matchAll(/<Key>([^<]*)<\/Key>/g)) keys.push(match[1] as string);
    token = /<NextContinuationToken>([^<]*)</.exec(text)?.[1];
  } while (token);
  return keys;
}

export async function deleteObject(key: string): Promise<void> {
  await attempt(() => signed('DELETE', key, {}, Buffer.alloc(0)), [200, 204]);
}

/** Removes what an action wrote before it failed; the action's own outage answer still stands. */
export async function removeQuietly(keys: string[]): Promise<void> {
  await Promise.allSettled(keys.map((key) => deleteObject(key)));
}

export function objectKeys(clientId: string, jobId: string) {
  const root = `clients/${clientId}/jobs/${jobId}`;
  return {
    frame: (sha256: string) => `${root}/frames/${sha256}`,
    attachment: (id: string) => `${root}/attachments/${id}`,
    film: (renderId: string) => `${root}/films/${renderId}`,
    packageFile: (packageId: string, name: string) => `${root}/packages/${packageId}/${name}`,
    feeLetter: (letterId: string) => `${root}/letters/${letterId}/fee-letter.pdf`,
  };
}
