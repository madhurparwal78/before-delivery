import type { IncomingMessage, ServerResponse } from 'node:http';
import { MAX_BODY_BYTES } from './config.js';
import { errors } from './errors.js';

export const INSTANCE_HEADER = 'X-Gandyboard-Instance';
export const ROUTE_HEADER = 'x-gandyboard-route';

export function parseCookies(header: string | undefined): Map<string, string> {
  const jar = new Map<string, string>();
  if (!header) return jar;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    jar.set(part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim()));
  }
  return jar;
}

export function sessionCookie(name: string, value: string, maxAgeSeconds: number): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  return parts.join('; ');
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/** The server boundary: size, content type and JSON shape, checked before anything else. */
export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const method = req.method ?? 'GET';
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw errors.bodyTooLarge();
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');

  if (WRITE_METHODS.has(method)) {
    const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (raw.length > 0 && type !== 'application/json') throw errors.badContentType();
    if (raw.length === 0 && type !== 'application/json' && type !== '') {
      throw errors.badContentType();
    }
  }

  if (raw.trim() === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw errors.badJson();
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw errors.badJson();
  }
  return parsed as Record<string, unknown>;
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body ?? null);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}
