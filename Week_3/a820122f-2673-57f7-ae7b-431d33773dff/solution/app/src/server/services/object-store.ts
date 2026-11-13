import { createHash, createHmac } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { config } from '../config.js';

const ALGORITHM = 'AWS4-HMAC-SHA256';
const SERVICE = 's3';
/** SigV4's fixed scope terminator and header prefix. */
const SCOPE_TERMINATOR = ['aws4', 'request'].join('_');
const AMZ = 'x-amz-';

type ObjectRequest = {
  method: 'GET' | 'PUT' | 'HEAD';
  path: string;
  body?: Buffer;
  contentType?: string;
};

type ObjectResponse = { status: number; body: Buffer };

function sha256Hex(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

function amzDate(now: Date): { stamp: string; date: string } {
  const stamp = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  return { stamp, date: stamp.slice(0, 8) };
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/** Signs one S3 request with Signature Version 4 and sends it on a fresh connection. */
function send(request: ObjectRequest): Promise<ObjectResponse> {
  const endpoint = new URL(config.s3.endpoint);
  const canonicalPath = encodePath(request.path);
  const body = request.body ?? Buffer.alloc(0);
  const payloadHash = sha256Hex(body);
  const { stamp, date } = amzDate(new Date());
  const host = endpoint.host;
  const headers: Record<string, string> = {
    host,
    [`${AMZ}content-sha256`]: payloadHash,
    [`${AMZ}date`]: stamp,
  };
  if (request.contentType !== undefined) headers['content-type'] = request.contentType;
  if (request.method === 'PUT') headers['content-length'] = String(body.byteLength);

  const signedHeaders = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaders
    .map((name) => `${name}:${(headers[name] as string).trim()}\n`)
    .join('');
  const canonicalRequest = [
    request.method,
    canonicalPath,
    '',
    canonicalHeaders,
    signedHeaders.join(';'),
    payloadHash,
  ].join('\n');
  const scope = `${date}/${config.s3.region}/${SERVICE}/${SCOPE_TERMINATOR}`;
  const stringToSign = [ALGORITHM, stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.s3.secretAccessKey}`, date), config.s3.region), SERVICE),
    SCOPE_TERMINATOR,
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  headers['authorization'] =
    `${ALGORITHM} Credential=${config.s3.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`;

  const transport = endpoint.protocol === 'https:' ? https : http;
  return new Promise<ObjectResponse>((resolve, reject) => {
    const outgoing = transport.request(
      {
        protocol: endpoint.protocol,
        hostname: endpoint.hostname,
        port: endpoint.port,
        method: request.method,
        path: canonicalPath,
        headers,
        agent: false,
        timeout: 8000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks) }),
        );
      },
    );
    outgoing.on('timeout', () => outgoing.destroy(new Error('The archive did not answer in time')));
    outgoing.on('error', reject);
    if (body.byteLength > 0) outgoing.write(body);
    outgoing.end();
  });
}

export async function headBucket(): Promise<boolean> {
  const response = await send({ method: 'HEAD', path: `/${config.s3.bucket}` });
  return response.status >= 200 && response.status < 300;
}

export async function putObject(key: string, body: Buffer): Promise<void> {
  const response = await send({
    method: 'PUT',
    path: `/${config.s3.bucket}/${key}`,
    body,
    contentType: 'application/pdf',
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`The archive refused ${key} with status ${response.status}`);
  }
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await send({ method: 'GET', path: `/${config.s3.bucket}/${key}` });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`The archive did not return ${key}: status ${response.status}`);
  }
  return response.body;
}
