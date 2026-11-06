import type { IncomingMessage } from 'node:http';
import * as nodeCrypto from 'node:crypto';

export interface ApiError extends Error {
  status: number;
  code: string;
  extra?: Record<string, unknown>;
}

export function apiError(status: number, code: string, message: string, extra?: Record<string, unknown>): ApiError {
  const e = Object.assign(new Error(message), { status, code, extra }) as ApiError;
  return e;
}

export function validationError(errors: Record<string, string>): ApiError {
  return apiError(422, 'validation', 'Some fields need attention', { errors });
}

export interface ResponseSink {
  writeHead(status: number, headers: Record<string, string>): unknown;
  end(body?: unknown): unknown;
}

export function sendJson(res: ResponseSink, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const buf = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': String(buf.length),
    ...headers,
  });
  res.end(buf);
}

export async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const type = String(req.headers['content-type'] ?? '');
  const mt = type.split(';')[0]!.trim().toLowerCase();
  if (mt !== 'application/json') throw apiError(415, 'unsupported_media_type', 'Send the body as application/json');
  return await readRawBody(req, maxBytes).then(b => {
    try {
      return JSON.parse(b.toString('utf8'));
    } catch {
      throw apiError(400, 'invalid_json', 'Send a valid JSON body');
    }
  });
}

// For endpoints whose request body is `{}`: accept an absent body as an empty object.
export async function readOptionalJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const type = String(req.headers['content-type'] ?? '');
  const mt = type.split(';')[0]!.trim().toLowerCase();
  const len = Number(req.headers['content-length'] ?? '0');
  if (mt === '' && len === 0) return {};
  return readJsonBody(req, maxBytes);
}

export function readRawBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > maxBytes) {
        done = true;
        reject(Object.assign(new Error('payload'), { apiError: apiError(413, 'payload_too_large', 'The request body is too large') }));
        req.removeAllListeners('data');
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on('error', () => { if (!done) { done = true; reject(Object.assign(new Error('aborted'), { apiError: apiError(400, 'client_disconnected', 'The request did not complete') })); } });
  });
}

export function newId(prefix: string): string {
  const hex = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 24; i++) s += hex[Math.floor(Math.random() * 16)];
  return `${prefix}-${s}`;
}

export function sha256Hex(buf: Buffer | string): string {
  const { createHash } = nodeCrypto;
  return createHash('sha256').update(buf).digest('hex');
}

export function randomToken(): string {
  const { randomBytes } = nodeCrypto;
  return randomBytes(32).toString('hex');
}

export function isoNow(): string { return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'); }
