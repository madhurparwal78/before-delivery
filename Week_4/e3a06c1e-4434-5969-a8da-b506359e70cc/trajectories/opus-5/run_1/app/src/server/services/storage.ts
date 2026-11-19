import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';
import { storageUnavailable } from '../http/errors.js';

const SERVICE = 's3';
const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

const sha256Hex = (body: Buffer | string): string => createHash('sha256').update(body).digest('hex');

const hmac = (key: Buffer | string, value: string): Buffer => createHmac('sha256', key).update(value).digest();

const encodeSegment = (value: string): string =>
  encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

const encodePath = (path: string): string => path.split('/').map(encodeSegment).join('/');

interface SignedRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
}

const sign = (method: string, objectPath: string, payload: Buffer | null): SignedRequest => {
  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const endpoint = new URL(config.s3.endpoint);
  const basePath = config.s3.forcePathStyle ? `/${config.s3.bucket}` : '';
  const canonicalUri = `${basePath}${objectPath === '' ? '/' : `/${encodePath(objectPath)}`}`;
  const host = endpoint.host;
  const payloadHash = payload === null ? EMPTY_SHA256 : sha256Hex(payload);

  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${config.s3.region}/${SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  const dateKey = hmac(`AWS4${config.s3.secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, config.s3.region);
  const serviceKey = hmac(regionKey, SERVICE);
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return {
    url: `${endpoint.origin}${canonicalUri}`,
    headers: {
      host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
      authorization: `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
};

const request = async (
  method: string,
  objectPath: string,
  payload: Buffer | null,
  timeoutMs: number,
): Promise<Response> => {
  const signed = sign(method, objectPath, payload);
  return fetch(signed.url, {
    method,
    headers: signed.headers,
    ...(payload === null ? {} : { body: new Uint8Array(payload) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
};

/** An upload counts as complete only after storage confirms the object. */
export const putObject = async (key: string, body: Buffer): Promise<void> => {
  let response: Response;
  try {
    response = await request('PUT', key, body, 30_000);
  } catch {
    throw storageUnavailable();
  }
  await response.arrayBuffer();
  if (!response.ok) throw storageUnavailable();
};

export const getObject = async (key: string): Promise<Buffer> => {
  let response: Response;
  try {
    response = await request('GET', key, null, 30_000);
  } catch {
    throw storageUnavailable();
  }
  if (!response.ok) {
    await response.arrayBuffer();
    throw storageUnavailable();
  }
  return Buffer.from(await response.arrayBuffer());
};

export const objectExists = async (key: string): Promise<boolean> => {
  let response: Response;
  try {
    response = await request('HEAD', key, null, 10_000);
  } catch {
    throw storageUnavailable();
  }
  if (response.status === 404) return false;
  if (!response.ok) throw storageUnavailable();
  return true;
};

const prefix = (orgId: string, projectId: string): string => `orgs/${orgId}/projects/${projectId}`;

export const sessionKeys = (orgId: string, projectId: string, sessionId: string) => ({
  upload: `${prefix(orgId, projectId)}/sessions/${sessionId}/upload.wav`,
  sidecar: `${prefix(orgId, projectId)}/sessions/${sessionId}/sidecar.vtt`,
  capture: `${prefix(orgId, projectId)}/sessions/${sessionId}/capture.pcm`,
  transcript: `${prefix(orgId, projectId)}/sessions/${sessionId}/machine-transcript.json`,
});

export const synthesisKey = (orgId: string, projectId: string, jobId: string): string =>
  `${prefix(orgId, projectId)}/synthesis/${jobId}.wav`;
