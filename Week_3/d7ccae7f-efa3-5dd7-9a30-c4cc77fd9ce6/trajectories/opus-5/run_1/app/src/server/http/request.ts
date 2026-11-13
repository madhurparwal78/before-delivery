import type { IncomingMessage } from 'node:http';
import { JSON_BODY_LIMIT, UPLOAD_BODY_LIMIT } from '../../shared/protocol.js';
import { SESSION_COOKIE } from '../config.js';
import { crossOrigin, payloadTooLarge } from '../errors.js';
import { parseJsonObject, type Json } from '../parse.js';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function requestUrl(req: IncomingMessage): URL {
  const host = req.headers.host ?? 'localhost';
  return new URL(req.url ?? '/', `http://${host}`);
}

export function assertSameOrigin(req: IncomingMessage): void {
  if (!STATE_CHANGING.has(req.method ?? 'GET')) return;
  const origin = req.headers.origin;
  if (origin === undefined || origin === 'null') return;
  const host = req.headers.host;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw crossOrigin();
  }
  if (host === undefined || originHost !== host) throw crossOrigin();
}

async function readBodyBytes(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) throw payloadTooLarge();
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const part = chunk as Buffer;
    total += part.byteLength;
    if (total > limit) {
      req.destroy();
      throw payloadTooLarge();
    }
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}

export async function readJsonBody(req: IncomingMessage): Promise<Json> {
  const bytes = await readBodyBytes(req, JSON_BODY_LIMIT);
  if (bytes.byteLength === 0) return {};
  return parseJsonObject(bytes.toString('utf8'));
}

export async function readUploadBody(req: IncomingMessage): Promise<Buffer> {
  return readBodyBytes(req, UPLOAD_BODY_LIMIT);
}

export function readSessionCookie(req: IncomingMessage): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.split('=');
    if (name?.trim() === SESSION_COOKIE) return decodeURIComponent(rest.join('=').trim());
  }
  return null;
}
