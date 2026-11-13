import { createHash, createHmac } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { config } from '../config';

class StorageDown extends Error {}

interface S3Response {
  status: number;
  body: Buffer;
  contentLength: number;
}

function sign(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function sha256Hex(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function encodeKeyPath(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

async function send(
  method: 'PUT' | 'GET' | 'DELETE' | 'HEAD',
  objectKey: string | null,
  payload: Buffer,
  contentType: string | null,
  timeoutMs: number,
): Promise<S3Response> {
  const endpoint = new URL(config.s3.endpoint);
  const pathPrefix = config.s3.forcePathStyle ? `/${config.s3.bucket}` : '';
  const path = objectKey === null ? `${pathPrefix}/` : `${pathPrefix}/${encodeKeyPath(objectKey)}`;
  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(payload);
  const host = endpoint.host;

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (contentType !== null) headers['content-type'] = contentType;
  if (method === 'PUT') headers['content-length'] = String(payload.length);

  const signedHeaders = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaders.map((name) => `${name}:${headers[name]}\n`).join('');
  const canonicalRequest = [
    method,
    path,
    '',
    canonicalHeaders,
    signedHeaders.join(';'),
    payloadHash,
  ].join('\n');
  const scope = `${dateStamp}/${config.s3.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = sign(sign(sign(sign(`AWS4${config.s3.secretAccessKey}`, dateStamp), config.s3.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  headers['authorization'] =
    `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`;

  const transport = endpoint.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise<S3Response>((resolve, reject) => {
    const clientRequest = transport(
      {
        protocol: endpoint.protocol,
        hostname: endpoint.hostname,
        port: endpoint.port,
        method,
        path,
        headers,
        timeout: timeoutMs,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks),
            contentLength: Number(response.headers['content-length'] ?? -1),
          }),
        );
        response.on('error', () => reject(new StorageDown()));
      },
    );
    clientRequest.on('timeout', () => {
      clientRequest.destroy();
      reject(new StorageDown());
    });
    clientRequest.on('error', () => reject(new StorageDown()));
    if (method === 'PUT') clientRequest.write(payload);
    clientRequest.end();
  });
}

const EMPTY = Buffer.alloc(0);

/** The one seam to object storage. Every failure to reach or use it reads as an outage. */
class Storage {
  private reachable = true;

  status(): 'up' | 'down' {
    return this.reachable ? 'up' : 'down';
  }

  startProbing(): void {
    const probe = async (): Promise<void> => {
      try {
        await send('HEAD', null, EMPTY, null, 2000);
        this.reachable = true;
      } catch {
        this.reachable = false;
      }
    };
    void probe();
    setInterval(() => void probe(), 2000).unref();
  }

  objectKey(workspaceId: string, cardId: string, attachmentId: string): string {
    return `attachments/${workspaceId}/${cardId}/${attachmentId}`;
  }

  private async call(
    method: 'PUT' | 'GET' | 'DELETE' | 'HEAD',
    key: string,
    payload: Buffer,
    contentType: string | null,
  ): Promise<S3Response> {
    try {
      const response = await send(method, key, payload, contentType, 15000);
      this.reachable = true;
      return response;
    } catch {
      this.reachable = false;
      throw new StorageDown();
    }
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    const response = await this.call('PUT', key, bytes, contentType);
    if (response.status < 200 || response.status >= 300) throw new StorageDown();
  }

  async storedSize(key: string): Promise<number> {
    const response = await this.call('HEAD', key, EMPTY, null);
    if (response.status !== 200) throw new StorageDown();
    return response.contentLength;
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.call('GET', key, EMPTY, null);
    if (response.status !== 200) throw new StorageDown();
    return response.body;
  }

  async remove(key: string): Promise<void> {
    const response = await this.call('DELETE', key, EMPTY, null);
    if (response.status !== 204 && response.status !== 200 && response.status !== 404) throw new StorageDown();
  }
}

export const storage = new Storage();
export { StorageDown };
