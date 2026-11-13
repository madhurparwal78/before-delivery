import type { IncomingMessage, ServerResponse } from 'node:http';
import { bodyTooLarge, fileTooLarge } from './errors.js';

export const JSON_BODY_LIMIT = 65_536;
export const UPLOAD_FILE_LIMIT = 20_000_000;
export const MULTIPART_LIMIT = 20_100_000;

export async function readRequestBody(request: IncomingMessage, limit: number, kind: 'json' | 'multipart'): Promise<Buffer> {
  const tooLarge = (): Error => (kind === 'json' ? bodyTooLarge() : fileTooLarge());
  const declared = Number(request.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > limit) {
    request.resume();
    throw tooLarge();
  }
  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    request.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) {
        request.destroy();
        reject(tooLarge());
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', (error) => reject(error));
  });
}

export function sendJson(response: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  response.end(payload);
}

export function sendNoContent(response: ServerResponse, headers: Record<string, string> = {}): void {
  response.writeHead(204, { 'cache-control': 'no-store', ...headers });
  response.end();
}

export function sendBytes(
  response: ServerResponse,
  status: number,
  bytes: Buffer,
  headers: Record<string, string>,
): void {
  response.writeHead(status, {
    'content-length': bytes.length,
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  response.end(bytes);
}
