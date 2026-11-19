import { createHash, createHmac } from 'node:crypto';
import { config } from '../config';

const SERVICE = 's3';
const TIMEOUT_MS = 5000;

export class FileStoreDown extends Error {}

function sha256(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function stamp(now: Date): { date: string; dateTime: string } {
  const dateTime = `${now.toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`;
  return { date: dateTime.slice(0, 8), dateTime };
}

function signedRequest(
  method: string,
  key: string,
  payload: Buffer,
): { url: string; headers: Record<string, string> } {
  const base = new URL(config.s3.endpoint);
  const path = config.s3.forcePathStyle
    ? `/${config.s3.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`
    : `/${key.split('/').map(encodeURIComponent).join('/')}`;
  const host = config.s3.forcePathStyle ? base.host : `${config.s3.bucket}.${base.host}`;
  const { date, dateTime } = stamp(new Date());
  const payloadHash = sha256(payload);

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': dateTime,
  };
  const signedHeaders = Object.keys(headers).sort();
  const canonical = [
    method,
    path,
    '',
    ...signedHeaders.map((name) => `${name}:${headers[name]}`),
    '',
    signedHeaders.join(';'),
    payloadHash,
  ].join('\n');

  const scope = `${date}/${config.s3.region}/${SERVICE}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', dateTime, scope, sha256(canonical)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, date), config.s3.region), SERVICE),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');

  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`;
  return { url: `${base.origin}${path}`, headers };
}

async function call(method: string, key: string, payload: Buffer): Promise<Response> {
  const { url, headers } = signedRequest(method, key, payload);
  try {
    return await fetch(url, {
      method,
      headers,
      body: method === 'PUT' ? payload : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new FileStoreDown('the file store did not answer');
  }
}

/** Objects go to MinIO byte for byte, and nothing counts as kept until it confirms. */
export const files = {
  async put(key: string, content: Buffer, contentType: string): Promise<void> {
    const { url, headers } = signedRequest('PUT', key, content);
    let answer: Response;
    try {
      answer = await fetch(url, {
        method: 'PUT',
        headers: { ...headers, 'content-type': contentType, 'content-length': String(content.length) },
        body: content,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new FileStoreDown('the file store did not answer');
    }
    if (!answer.ok) throw new FileStoreDown(`the file store answered ${answer.status}`);
  },

  async get(key: string): Promise<Buffer> {
    const answer = await call('GET', key, Buffer.alloc(0));
    if (!answer.ok) throw new FileStoreDown(`the file store answered ${answer.status}`);
    return Buffer.from(await answer.arrayBuffer());
  },

  async remove(key: string): Promise<void> {
    const answer = await call('DELETE', key, Buffer.alloc(0));
    if (!answer.ok && answer.status !== 404) {
      throw new FileStoreDown(`the file store answered ${answer.status}`);
    }
  },
};
