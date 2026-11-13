// Shared HTTP plumbing: one error shape, one precedence order, one router.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiError } from './errors.js';
import { buildErrorBody } from './errors.js';

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  body: unknown;
  rawBody: Buffer;
  origin: string | null;
  callerAddress: string;
  cookies: Record<string, string>;
  setCookies: Array<{ name: string; value: string; httpOnly: boolean; maxAge: number | null; path: string; sameSite: 'Strict' | 'Lax' }>;
}

export type Handler = (ctx: Ctx) => Promise<void>;

export function json(res: ServerResponse, status: number, body: unknown, headers?: Record<string, string>): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(Buffer.byteLength(payload)),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

export function sendError(res: ServerResponse, err: ApiError): void {
  json(res, err.status, buildErrorBody(err), err.headers);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) out[name] = value;
  }
  return out;
}

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  return await new Promise((resolve) => {
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve(Buffer.concat(chunks)));
  });
}
