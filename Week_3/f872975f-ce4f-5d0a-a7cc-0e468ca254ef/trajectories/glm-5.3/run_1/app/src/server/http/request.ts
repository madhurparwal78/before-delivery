import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError } from './errors.js';
import type { User } from '../db/store.js';

export const JSON_LIMIT = 65536;
export const PHOTO_LIMIT = 5000000;

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  query: URLSearchParams;
  bodyBuffer: Buffer;
  user: User | null;
  sessionToken: string | null;
  contentType: string;
  origin: string | null;
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(payload);
}

export function sendBytes(res: ServerResponse, status: number, contentType: string, body: Buffer, extra: Record<string, string> = {}): void {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': String(body.length),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  });
  res.end(body);
}

export interface BodyResult {
  buffer: Buffer;
  overflow: boolean;
}

export function readBody(req: IncomingMessage, limit: number): Promise<BodyResult> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let overflow = false;
    req.on('data', (chunk: Buffer) => {
      if (overflow) return;
      size += chunk.length;
      if (size > limit) {
        overflow = true;
        chunks.length = 0;
        req.removeAllListeners('data');
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolve({ buffer: overflow ? Buffer.alloc(0) : Buffer.concat(chunks), overflow });
    });
    req.on('error', reject);
  });
}

/** Parse a JSON request body, applying the boundary checks in order. */
export function readJsonBody(contentType: string, bodyBuffer: Buffer): unknown {
  if (!contentType.startsWith('application/json')) {
    throw new ApiError('unsupported_media_type', 'JSON required');
  }
  if (bodyBuffer.length > JSON_LIMIT) throw new ApiError('too_large', 'Body too large');
  try {
    return JSON.parse(bodyBuffer.toString('utf8'));
  } catch {
    throw new ApiError('bad_json', 'Body is not valid JSON');
  }
}

export function boundaryChecks(method: string, origin: string | null, ownOrigin: string): void {
  if (['POST', 'PUT', 'DELETE'].includes(method) && origin !== null && origin !== ownOrigin) {
    throw new ApiError('cross_origin', 'Cross-origin request refused');
  }
}
