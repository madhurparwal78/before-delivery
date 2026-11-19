import { createHash, createHmac } from 'node:crypto';
import { request } from 'node:http';
import { config } from './config.js';

export class StorageUnavailable extends Error {}

const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex');
const hmac = (key: Buffer | string, value: string): Buffer =>
  createHmac('sha256', key).update(value).digest();

interface SignedRequest {
  method: string;
  key: string;
  body?: Buffer;
  contentType?: string;
}

function stamp(): { date: string; dateTime: string } {
  const iso = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
  return { date: iso.slice(0, 8), dateTime: iso };
}

function sign(req: SignedRequest, url: URL): Record<string, string> {
  const { date, dateTime } = stamp();
  const payloadHash = sha256(req.body ?? Buffer.alloc(0));
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': dateTime,
  };
  if (req.contentType !== undefined) headers['content-type'] = req.contentType;
  if (req.body !== undefined) headers['content-length'] = String(req.body.length);

  const signedHeaderNames = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = signedHeaderNames
    .map((name) => `${name}:${String(headers[name]).trim()}\n`)
    .join('');
  const canonicalRequest = [
    req.method,
    url.pathname,
    url.searchParams.toString(),
    canonicalHeaders,
    signedHeaderNames.join(';'),
    payloadHash,
  ].join('\n');
  const scope = `${date}/${config.storage.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', dateTime, scope, sha256(canonicalRequest)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.storage.secretAccessKey}`, date), config.storage.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.storage.accessKeyId}/${scope}, SignedHeaders=${signedHeaderNames.join(';')}, Signature=${signature}`;
  return headers;
}

interface StorageReply {
  status: number;
  body: Buffer;
  headers: Record<string, string | string[] | undefined>;
}

function send(req: SignedRequest): Promise<StorageReply> {
  const base = new URL(config.storage.endpoint);
  const path = config.storage.forcePathStyle
    ? `/${config.storage.bucket}${req.key === '' ? '' : `/${req.key}`}`
    : `/${req.key}`;
  const url = new URL(path, base);
  const headers = sign(req, url);
  return new Promise((resolve, reject) => {
    const call = request(
      {
        host: url.hostname,
        port: url.port === '' ? 80 : Number(url.port),
        method: req.method,
        path: `${url.pathname}${url.search}`,
        headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks),
            headers: response.headers,
          }),
        );
      },
    );
    call.setTimeout(4000, () => {
      call.destroy(new StorageUnavailable('timeout'));
    });
    call.on('error', (error) => reject(new StorageUnavailable(error.message)));
    if (req.body !== undefined) call.write(req.body);
    call.end();
  });
}

/** An object counts as stored only once the store reports a matching size and checksum. */
export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<{ size: number; sha256: string }> {
  const put = await send({ method: 'PUT', key, body, contentType });
  if (put.status >= 300) throw new StorageUnavailable(`put ${put.status}`);
  const head = await send({ method: 'HEAD', key });
  if (head.status >= 300) throw new StorageUnavailable(`head ${head.status}`);
  const size = Number(head.headers['content-length'] ?? '-1');
  const etag = String(head.headers.etag ?? '').replace(/"/g, '');
  const md5 = createHash('md5').update(body).digest('hex');
  if (size !== body.length || (etag !== '' && etag !== md5)) {
    await deleteObject(key);
    throw new StorageUnavailable('checksum mismatch');
  }
  return { size: body.length, sha256: sha256(body) };
}

export async function getObject(key: string): Promise<Buffer> {
  const reply = await send({ method: 'GET', key });
  if (reply.status >= 300) throw new StorageUnavailable(`get ${reply.status}`);
  return reply.body;
}

export async function deleteObject(key: string): Promise<void> {
  try {
    await send({ method: 'DELETE', key });
  } catch {
    /* a missing object needs no deleting */
  }
}

export async function storageReachable(): Promise<boolean> {
  try {
    const reply = await send({ method: 'GET', key: '' });
    return reply.status < 500;
  } catch {
    return false;
  }
}

export async function ensureBucket(): Promise<void> {
  const reply = await send({ method: 'HEAD', key: '' });
  if (reply.status === 404) await send({ method: 'PUT', key: '' });
}
